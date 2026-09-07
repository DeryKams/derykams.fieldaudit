<?php

namespace Derykams\FieldAudit;

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
	/**
	 * Оценивает все включённые правила, возвращает сработавшие.
	 *
	 * @param array $rules  правила из Options
	 * @param array $states [fieldId => ['prev'=>mixed,'curr'=>mixed]]
	 * @param array $context контекст операции: ['stageId' => новая стадия сделки]
	 * @return array[] [{rule, action: {type,bpId,fillWindowTitle}, activeLeafFieldIds:[fieldId,...]}]
	 */
	public static function evaluateRules(array $rules, array $states, array $context = []): array
	{
		$triggered = [];

		foreach ($rules as $rule)
		{
			if (!is_array($rule) || ($rule['enabled'] ?? false) === false)
			{
				continue;
			}

			/* Гейт по целевой стадии: действие срабатывает только если
			   сделка переходит на указанную стадию (STAGE_ID нового значения). */
			$targetStageId = (string)($rule['stageId'] ?? '');
			if ($targetStageId !== '' && (string)($context['stageId'] ?? '') !== $targetStageId)
			{
				continue;
			}

			$condition = $rule['condition'] ?? null;
			if (!is_array($condition))
			{
				continue;
			}

			$result = self::evaluateNode($condition, $states);
			if (!$result['ok'])
			{
				continue;
			}

			/* Действие: новый формат — rule.action; старый формат — на листьях.
			   Мигрируем старый на лету, чтобы существующие правила не «молчали». */
			$action = self::resolveAction($rule, $result['activeLeaves']);
			if ($action === null)
			{
				continue;
			}

			$activeLeafFieldIds = array_map(
				static fn (array $leaf) => (string)($leaf['fieldId'] ?? ''),
				$result['activeLeaves']
			);

			$triggered[] = [
				'rule' => $rule,
				'action' => $action,
				'activeLeafFieldIds' => array_values(array_filter($activeLeafFieldIds)),
			];
		}

		return $triggered;
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
	private static function evaluateNode(array $node, array $states): array
	{
		$type = (string)($node['type'] ?? '');

		if ($type === 'field')
		{
			$ok = self::checkLeaf($node, $states);
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

		foreach ($children as $child)
		{
			if (!is_array($child))
			{
				if ($isAnd)
				{
					return ['ok' => false, 'activeLeaves' => []];
				}

				continue;
			}

			$childResult = self::evaluateNode($child, $states);
			if ($childResult['ok'])
			{
				/* ИЛИ: первая же истина — можно не считать дальше,
				   И: копим активные листья, пока все дети истинны. */
				if (!$isAnd)
				{
					return ['ok' => true, 'activeLeaves' => $childResult['activeLeaves']];
				}

				$activeLeaves = array_merge($activeLeaves, $childResult['activeLeaves']);
			}
			elseif ($isAnd)
			{
				return ['ok' => false, 'activeLeaves' => []];
			}
		}

		/* И: дошли до конца — все дети истинны.
		   ИЛИ: дошли до конца — ни один ребёнок не истинен. */
		return ['ok' => $isAnd, 'activeLeaves' => $isAnd ? $activeLeaves : []];
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
				static fn ($v) => $v !== null && $v !== '' && $v !== [] && $v !== 0 && $v !== '0'
			);

			return $flat === [] ? '' : Json::encode($value, JSON_UNESCAPED_UNICODE);
		}

		return trim((string)$value);
	}
}