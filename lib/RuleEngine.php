<?php

namespace Derykams\FieldAudit;

use Bitrix\Main\Web\Json;

/**
 * Движок правил: оценивает дерево условий правила над значениями полей
 * и возвращает действие правила из истинной ветки.
 *
 * Схема правила (JSON из настроек модуля, действия — на уровне правила):
 *   rule: {id, title, enabled, condition: node, action: {type:'bp'|'fill', bpId, fillWindowTitle}}
 *   node group: {type:'group', logic:'and'|'or', children:[node...]}
 *   node field: {type:'field', fieldId, trigger:'change'|'fill',
 *                operator:'changed'|'changed_to_filled'|'changed_to_empty'
 *                         |'filled'|'not_filled'}
 *
 * Условие — чистое дерево, без действий в листьях. Действие одно на правило.
 *
 * Значения полей движку передаёт вызывающий (Tracker/RuleHandler):
 *   states = [fieldId => ['prev' => mixed, 'curr' => mixed]]
 * prev — значение до сохранения, curr — новое.
 */
final class RuleEngine
{
	/** Новый список имеет приоритет, в том числе пустой; stageId — старый формат. */
	public static function stageIds(array $rule): array
	{
		return array_key_exists('stageIds', $rule)
			? $rule['stageIds']
			: (($rule['stageId'] ?? '') !== '' ? [$rule['stageId']] : []);
	}

	/**
	 * Оценивает все включённые правила, возвращает сработавшие.
	 *
	 * @param array $rules  правила из Options
	 * @param array $states [fieldId => ['prev'=>mixed,'curr'=>mixed]]
	 * @param array $context контекст операции: ['stageId' => новая стадия сделки]
	 * @return array[] [{rule, action: {type,bpId,fillWindowTitle}, activeLeafFieldIds:[fieldId,...]}]
	 */
	public static function evaluateRules(array $rules, array $states, array $context = [], ?callable $trace = null): array
	{
		$triggered = [];

		foreach ($rules as $rule)
		{
			$report = static function (string $event, array $data) use ($trace, $rule): void {
				if ($trace) $trace($event, ['ruleId' => is_array($rule) ? ($rule['id'] ?? '') : ''] + $data);
			};
			if (!is_array($rule) || ($rule['enabled'] ?? false) === false)
			{
				$report('rule.skip', ['reason' => 'disabled_or_invalid']);
				continue;
			}

			// Между выбранными стадиями — ИЛИ, с деревом условий полей — И.
			$targetStageIds = self::stageIds($rule);
			$currentStageId = (string)($context['stageId'] ?? '');
			$report('rule.stage', [
				'targetStageIds' => $targetStageIds, 'stageMode' => $rule['stageMode'] ?? 'changed_to',
				'previousStageId' => $context['previousStageId'] ?? '', 'stageId' => $context['stageId'] ?? '',
			]);
			if ($targetStageIds !== [] && !in_array($currentStageId, $targetStageIds, true))
			{
				$report('rule.skip', ['reason' => 'target_stage_mismatch']);
				continue;
			}

			if ($targetStageIds !== [] && ($rule['stageMode'] ?? 'changed_to') === 'changed_to'
				&& (string)($context['previousStageId'] ?? '') === $currentStageId)
			{
				$report('rule.skip', ['reason' => 'stage_not_changed']);
				continue;
			}

			$condition = $rule['condition'] ?? null;
			if (!is_array($condition))
			{
				$report('rule.skip', ['reason' => 'invalid_condition']);
				continue;
			}

			$result = self::evaluateNode($condition, $states, $trace ? $report : null);
			$report('rule.condition', ['result' => $result['ok']]);
			if (!$result['ok'])
			{
				continue;
			}

			/* Действие: новый формат — rule.action; старый формат — на листьях.
			   Мигрируем старый на лету, чтобы существующие правила не «молчали». */
			$action = self::resolveAction($rule, $result['activeLeaves']);
			if ($action === null)
			{
				$report('rule.skip', ['reason' => 'no_action']);
				continue;
			}

			$activeLeafFieldIds = array_map(
				static fn (array $leaf) => (string)($leaf['fieldId'] ?? ''),
				$result['activeLeaves']
			);

			$triggered[] = [
				'rule' => $rule,
				'action' => $action,
				'activeLeafFieldIds' => array_values(array_unique(array_filter($activeLeafFieldIds))),
			];
		}

		return $triggered;
	}

	/** Поля действия задаются отдельно от условия. Пустой список — поля «Не заполнено» условия. */
	public static function fillFieldIds(array $rule): array
	{
		$explicit = $rule['action']['fillFieldIds'] ?? [];
		if (is_array($explicit) && $explicit !== [])
		{
			return array_values(array_unique(array_filter($explicit, 'is_string')));
		}
		$ids = [];
		$walk = static function (array $node) use (&$walk, &$ids): void {
			if (($node['type'] ?? '') === 'field' && ($node['operator'] ?? '') === 'not_filled')
			{
				$ids[] = (string)($node['fieldId'] ?? '');
			}
			foreach (($node['children'] ?? []) as $child)
			{
				if (is_array($child)) $walk($child);
			}
		};
		$walk($rule['condition'] ?? []);
		return array_values(array_unique(array_filter($ids)));
	}

	public static function isFilled(mixed $value): bool
	{
		return self::toComparableString($value) !== '';
	}

	public static function requirementSatisfied(array $requirement, array $states): bool
	{
		$ids = $requirement['fieldIds'] ?? [];
		if ($ids === []) return true;
		$filled = 0;
		foreach ($ids as $id)
		{
			if (self::isFilled($states[$id]['curr'] ?? null)) ++$filled;
		}
		return ($requirement['mode'] ?? 'all') === 'any' ? $filled > 0 : $filled === count($ids);
	}

	/** Только невыполненные требования сработавших правил; без правил всегда []. */
	public static function getFillRequirements(array $rules, array $states, array $context = [], ?callable $trace = null): array
	{
		$requirements = [];
		foreach (self::evaluateRules($rules, $states, $context, $trace) as $item)
		{
			if ($item['action']['type'] !== 'fill') continue;
			$rule = $item['rule'];
			$requirement = [
				'ruleId' => (string)($rule['id'] ?? ''),
				'title' => $item['action']['fillWindowTitle'] ?: (string)($rule['title'] ?? ''),
				'fieldIds' => self::fillFieldIds($rule),
				'mode' => ($rule['action']['fillMode'] ?? 'all') === 'any' ? 'any' : 'all',
			];
			$satisfied = self::requirementSatisfied($requirement, $states);
			if ($trace) $trace('rule.fill_requirement', $requirement + ['satisfied' => $satisfied]);
			if (!$satisfied) $requirements[] = $requirement;
		}
		return $requirements;
	}

	/**
	 * Определяет действие правила. Новый формат — rule.action.
	 * Старый формат (действия на листьях): собирает тип и параметры
	 * из активных листьев — правило начинает работать без ручной правки.
	 */
	private static function resolveAction(array $rule, array $activeLeaves): ?array
	{
		$action = $rule['action'] ?? null;
		if (is_array($action) && ($action['type'] ?? '') !== '')
		{
			return [
				'type' => (string)$action['type'],
				'bpId' => (string)($action['bpId'] ?? ''),
				'fillWindowTitle' => (string)($action['fillWindowTitle'] ?? ''),
			];
		}

		/* Старый формат: тип действия берём с первого активного листа,
		   параметры (bpId / fillWindowTitle) — с того же листа. */
		foreach ($activeLeaves as $leaf)
		{
			$type = (string)($leaf['action'] ?? '');
			if ($type === 'bp' || $type === 'fill')
			{
				return [
					'type' => $type,
					'bpId' => (string)($leaf['bpId'] ?? ''),
					'fillWindowTitle' => (string)($leaf['fillWindowTitle'] ?? ''),
				];
			}
		}

		return null;
	}

	/**
	 * Рекурсивная оценка узла. Возвращает ok и активные листья истинной ветки.
	 */
	private static function evaluateNode(array $node, array $states, ?callable $trace = null, string $path = 'condition'): array
	{
		$type = (string)($node['type'] ?? '');

		if ($type === 'field')
		{
			$ok = self::checkLeaf($node, $states);
			if ($trace)
			{
				$id = (string)($node['fieldId'] ?? '');
				$state = $states[$id] ?? [];
				$trace('condition.field', [
					'path' => $path, 'fieldId' => $id, 'operator' => $node['operator'] ?? '',
					'stateAvailable' => isset($states[$id]),
					'previousFilled' => self::isFilled($state['prev'] ?? null),
					'currentFilled' => self::isFilled($state['curr'] ?? null),
					'changed' => self::toComparableString($state['prev'] ?? null) !== self::toComparableString($state['curr'] ?? null),
					'result' => $ok,
				]);
			}
			return ['ok' => $ok, 'activeLeaves' => $ok ? [$node] : []];
		}

		if ($type !== 'group')
		{
			return ['ok' => false, 'activeLeaves' => []];
		}

		$children = $node['children'] ?? [];
		if (!is_array($children) || $children === [])
		{
			return ['ok' => false, 'activeLeaves' => []];
		}

		$logic = (string)($node['logic'] ?? 'and');
		$isAnd = ($logic !== 'or');
		$activeLeaves = [];
		$any = false;

		foreach ($children as $index => $child)
		{
			if (!is_array($child))
			{
				if ($isAnd)
				{
					return ['ok' => false, 'activeLeaves' => []];
				}

				continue;
			}

			$childResult = self::evaluateNode($child, $states, $trace, $path . '.children.' . $index);
			if ($childResult['ok'])
			{
				$any = true;
				$activeLeaves = array_merge($activeLeaves, $childResult['activeLeaves']);
			}
			elseif ($isAnd)
			{
				if ($trace) $trace('condition.group', ['path' => $path, 'logic' => $logic, 'result' => false, 'shortCircuitAt' => $index]);
				return ['ok' => false, 'activeLeaves' => []];
			}
		}

		/* И: дошли до конца — все дети истинны.
		   ИЛИ: дошли до конца — ни один ребёнок не истинен. */
		if ($trace) $trace('condition.group', ['path' => $path, 'logic' => $logic, 'result' => $isAnd || $any]);
		return ['ok' => $isAnd || $any, 'activeLeaves' => $activeLeaves];
	}

	/**
	 * Проверка листа. Порт JS checkLeaf.
	 */
	private static function checkLeaf(array $leaf, array $states): bool
	{
		$fieldId = (string)($leaf['fieldId'] ?? '');
		$state = $states[$fieldId] ?? ['prev' => '', 'curr' => ''];

		$prev = self::toComparableString($state['prev'] ?? '');
		$curr = self::toComparableString($state['curr'] ?? '');

		$changed = $prev !== $curr;
		$filled = $curr !== '';

		return match ((string)($leaf['operator'] ?? ''))
		{
			'changed' => $changed,
			'changed_to_filled' => $changed && $filled,
			'changed_to_empty' => $changed && !$filled && $prev !== '',
			'filled' => $filled,
			'not_filled' => !$filled,
			default => false,
		};
	}

	/**
	 * Приводит значение поля к строке для сравнения.
	 * Массив (множественное UF, файлы) — сериализуем: пустой массив → ''.
	 */
	private static function toComparableString(mixed $value): string
	{
		if ($value === null)
		{
			return '';
		}

		if (is_array($value))
		{
			$flat = array_filter(
				$value,
				static fn ($v) => $v !== null && $v !== '' && $v !== []
			);

			return $flat === [] ? '' : Json::encode($value, JSON_UNESCAPED_UNICODE);
		}

		return trim((string)$value);
	}
}
