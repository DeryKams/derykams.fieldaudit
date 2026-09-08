<?php

namespace Derykams\FieldAudit;

/** Проверка схемы на сервере, одинаковая для POST-страницы и AJAX. */
final class RuleConfig
{
	public static function validate(array $rules): void
	{
		if (count($rules) > 200) throw new \InvalidArgumentException('Слишком много правил (максимум 200).');
		$ids = [];
		foreach ($rules as $rule)
		{
			if (!is_array($rule) || !is_string($rule['id'] ?? null) || !preg_match('/^[a-zA-Z0-9_-]{1,100}$/D', $rule['id']))
			{
				throw new \InvalidArgumentException('Некорректный идентификатор правила.');
			}
			if (isset($ids[$rule['id']])) throw new \InvalidArgumentException('Идентификаторы правил должны быть уникальны.');
			$ids[$rule['id']] = true;
			if (!is_bool($rule['enabled'] ?? null)) throw new \InvalidArgumentException('Укажите состояние правила.');
			if (!is_string($rule['title'] ?? null)) throw new \InvalidArgumentException('Некорректное название правила.');
			if (!is_string($rule['stageId'] ?? '') || !in_array($rule['stageMode'] ?? 'changed_to', ['changed_to', 'is'], true))
			{
				throw new \InvalidArgumentException('Некорректное условие стадии.');
			}
			if (array_key_exists('stageIds', $rule))
			{
				if (!is_array($rule['stageIds']) || array_values($rule['stageIds']) !== $rule['stageIds'])
				{
					throw new \InvalidArgumentException('Некорректный список стадий.');
				}
				foreach ($rule['stageIds'] as $stageId)
				{
					if (!is_string($stageId) || trim($stageId) === '') throw new \InvalidArgumentException('Некорректный код стадии.');
				}
			}
			$count = 0;
			self::node($rule['condition'] ?? null, 0, $count, $rule['enabled']);
			$action = $rule['action'] ?? [];
			if (!is_array($action) || !in_array($action['type'] ?? '', ['fill', 'bp'], true)) throw new \InvalidArgumentException('Выберите одно действие правила.');
			if ($action['type'] === 'bp' && $rule['enabled'] && (!is_scalar($action['bpId'] ?? null) || (int)$action['bpId'] <= 0))
			{
				throw new \InvalidArgumentException('Выберите шаблон бизнес-процесса.');
			}
			if (!in_array($action['fillMode'] ?? 'all', ['any', 'all'], true)) throw new \InvalidArgumentException('Некорректный режим заполнения.');
			if (!is_array($action['fillFieldIds'] ?? [])) throw new \InvalidArgumentException('Некорректный список полей заполнения.');
			foreach (($action['fillFieldIds'] ?? []) as $fieldId) self::fieldId($fieldId);
			if ($action['type'] === 'fill' && $rule['enabled'] && RuleEngine::fillFieldIds($rule) === [])
			{
				throw new \InvalidArgumentException('Укажите поля для окна заполнения в правиле «' . $rule['title'] . '».');
			}
		}
	}

	private static function node(mixed $node, int $depth, int &$count, bool $enabled): void
	{
		if (!is_array($node) || $depth > 12 || ++$count > 500) throw new \InvalidArgumentException('Некорректное или слишком большое дерево условий.');
		if (($node['type'] ?? '') === 'field')
		{
			self::fieldId($node['fieldId'] ?? null);
			$operators = ['fill' => ['filled', 'not_filled'], 'change' => ['changed', 'changed_to_filled', 'changed_to_empty']];
			$trigger = $node['trigger'] ?? '';
			if (!is_string($trigger) || !in_array($node['operator'] ?? '', $operators[$trigger] ?? [], true)) throw new \InvalidArgumentException('Некорректный оператор поля.');
			return;
		}
		if (($node['type'] ?? '') !== 'group' || !in_array($node['logic'] ?? '', ['and', 'or'], true) || !is_array($node['children'] ?? null))
		{
			throw new \InvalidArgumentException('Некорректная группа условий.');
		}
		if ($enabled && $node['children'] === []) throw new \InvalidArgumentException('Заполните пустую группу условий.');
		foreach ($node['children'] as $child) self::node($child, $depth + 1, $count, $enabled);
	}

	private static function fieldId(mixed $id): void
	{
		if (!is_string($id) || !preg_match('/^[A-Z][A-Z0-9_]{0,99}$/D', $id)) throw new \InvalidArgumentException('Некорректный код поля.');
	}
}
