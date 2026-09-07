<?php

namespace Derykams\FieldAudit;

use Bitrix\Main\Type\DateTime;
use Bitrix\Main\Web\Json;

/**
 * Ядро трекинга: считает дифф полей Item и пишет его в AuditLogTable.
 *
 * Item (D7) хранит в себе состояние ДО сохранения:
 *   $item->isChanged($field)      — поле менялось в этой операции
 *   $item->remindActual($field)   — старое значение (до изменения)
 *   $item->get($field)            — новое значение
 *
 * Поэтому дифф берём прямо из объекта, без повторного чтения БД.
 */
final class Tracker
{
	/**
	 * Обработчик D7-события onCrmDynamicItemUpdate / onCrmDealUpdate.
	 *
	 * @param \Bitrix\Crm\Item $item сохранённый элемент
	 */
	public static function onItemUpdate(\Bitrix\Main\Event $event): void
	{
		$item = $event->getParameter('item');
		if (!($item instanceof \Bitrix\Crm\Item))
		{
			return;
		}

		$entityTypeId = $item->getEntityTypeId();
		if (!Options::isEntityTracked($entityTypeId))
		{
			return;
		}

		self::trackItem($item);
	}

	/**
	 * Считает дифф и пишет записи в лог.
	 */
	public static function trackItem(\Bitrix\Crm\Item $item): void
	{
		$entityTypeId = $item->getEntityTypeId();
		$entityId = $item->getId();
		if ($entityId <= 0)
		{
			return;
		}

		$userId = self::resolveUserId();
		$rows = [];

		foreach (array_keys($item->getFieldsMap()) as $commonFieldName)
		{
			if (!Options::isFieldTracked($entityTypeId, $commonFieldName))
			{
				continue;
			}

			try
			{
				if (!$item->isChanged($commonFieldName))
				{
					continue;
				}

				$oldValue = self::valueToString($item->remindActual($commonFieldName));
				$newValue = self::valueToString($item->get($commonFieldName));
			}
			catch (\Throwable)
			{
				// бывают виртуальные/вычисляемые поля без actual-значения — пропускаем
				continue;
			}

			if ($oldValue === $newValue)
			{
				continue;
			}

			$rows[] = [
				'ENTITY_TYPE_ID' => $entityTypeId,
				'ENTITY_ID' => $entityId,
				'FIELD_NAME' => mb_substr($commonFieldName, 0, 64),
				'OLD_VALUE' => $oldValue,
				'NEW_VALUE' => $newValue,
				'USER_ID' => $userId,
			];
		}

		foreach ($rows as $row)
		{
			try
			{
				AuditLogTable::add($row);
			}
			catch (\Throwable)
			{
				// аудит не должен ломать сохранение элемента — пишем мимо ошибок
			}
		}
	}

	/**
	 * Кто менял: из контекста операции, иначе текущий пользователь.
	 */
	private static function resolveUserId(): int
	{
		global $USER;

		try
		{
			$context = \Bitrix\Crm\Service\Container::getInstance()->getContext();
			$userId = $context->getUserId();
			if ($userId > 0)
			{
				return $userId;
			}
		}
		catch (\Throwable)
		{
		}

		return (is_object($USER) && method_exists($USER, 'GetID')) ? (int)$USER->GetID() : 0;
	}

	/**
	 * Приводит значение поля к строке для лога.
	 */
	private static function valueToString(mixed $value): string
	{
		if ($value === null)
		{
			return '';
		}

		if ($value instanceof DateTime)
		{
			return $value->format('d.m.Y H:i:s');
		}

		if (is_array($value))
		{
			// множественные UF приходят массивом
			return Json::encode($value, JSON_UNESCAPED_UNICODE) ?: '';
		}

		if (is_object($value) && !method_exists($value, '__toString'))
		{
			return get_class($value);
		}

		return (string)$value;
	}
}