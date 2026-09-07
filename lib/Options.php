<?php

namespace Derykams\FieldAudit;

use Bitrix\Main\Config\Option;
use Bitrix\Main\Web\Json;

/**
 * Настройки модуля в одной JSON-строке в b_option.
 *
 * Схема конфига:
 * {
 *   "entityTypeIds": [128, 149],        // какие сущности трекать (CCrmOwnerType::Deal = 2, SP = 128+)
 *   "fields": ["UF_CRM_123", "STAGE_ID"] // какие поля трекать; пустой массив = все поля
 * }
 */
final class Options
{
	public const MODULE_ID = 'derykams.fieldaudit';
	private const OPT_KEY = 'config_json';

	/** @var array|null кэш на запрос */
	private static ?array $cache = null;

	public static function get(): array
	{
		if (self::$cache !== null)
		{
			return self::$cache;
		}

		$raw = (string)Option::get(self::MODULE_ID, self::OPT_KEY, '');
		if ($raw === '')
		{
			return self::$cache = [];
		}

		try
		{
			return self::$cache = (Json::decode($raw) ?: []);
		}
		catch (\Throwable)
		{
			return self::$cache = [];
		}
	}

	public static function set(array $data): void
	{
		Option::set(self::MODULE_ID, self::OPT_KEY, Json::encode($data, JSON_UNESCAPED_UNICODE));
		self::$cache = $data;
	}

	public static function clear(): void
	{
		Option::delete(self::MODULE_ID, ['name' => self::OPT_KEY]);
		self::$cache = null;
	}

	/**
	 * Трекать ли данную сущность.
	 */
	public static function isEntityTracked(int $entityTypeId): bool
	{
		$config = self::get();

		// не настроено = трекаем все сущности, по которым приходит событие
		$entityTypeIds = $config['entityTypeIds'] ?? null;
		if ($entityTypeIds === null || $entityTypeIds === [])
		{
			return true;
		}

		return in_array($entityTypeId, (array)$entityTypeIds, true);
	}

	/**
	 * Трекать ли данное поле.
	 */
	public static function isFieldTracked(int $entityTypeId, string $fieldName): bool
	{
		$config = self::get();

		// ключ конфига: "fields_<entityTypeId>" или общий "fields"
		$fields = $config['fields_' . $entityTypeId] ?? ($config['fields'] ?? null);

		// пустой список = трекаем все поля
		if ($fields === null || !is_array($fields) || $fields === [])
		{
			return true;
		}

		return in_array($fieldName, $fields, true);
	}
}