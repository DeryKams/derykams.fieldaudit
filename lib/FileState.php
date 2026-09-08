<?php

namespace Derykams\FieldAudit;

use Bitrix\Main\Context;
use Bitrix\Main\UI\FileInputUtility;

/** Проекция файлов после сохранения. Не сохраняет и не удаляет физические файлы. */
final class FileState
{
	public static function fields(): array
	{
		static $fields = null;
		if ($fields === null)
		{
			$fields = array_filter($GLOBALS['USER_FIELD_MANAGER']->GetUserFields('CRM_DEAL'),
				static fn (array $field): bool => ($field['USER_TYPE_ID'] ?? '') === 'file');
		}
		return $fields;
	}

	/** Один upload-массив отличается от списка файлов множественного поля. */
	public static function entries(mixed $value, bool $multiple): array
	{
		if (!$multiple || !is_array($value)) return [$value];
		foreach (['old_id', 'tmp_name', 'del', 'name', 'error', 'ID'] as $key)
		{
			if (array_key_exists($key, $value)) return [$value];
		}
		return array_values($value);
	}

	/** Значения из БД не являются upload-операциями. Допускаем также сырой сериализованный список. */
	public static function storedValue(mixed $value, bool $multiple): array
	{
		if ($multiple && is_string($value) && str_starts_with($value, 'a:'))
		{
			$decoded = @unserialize($value, ['allowed_classes' => false]);
			if (is_array($decoded)) $value = $decoded;
		}
		$ids = [];
		foreach (self::entries($value, $multiple) as $entry)
		{
			$id = is_array($entry) ? ($entry['ID'] ?? null) : $entry;
			if (self::isId($id)) $ids[] = (string)(int)$id;
		}
		$ids = array_values(array_unique($ids));
		sort($ids, SORT_STRING);
		return $ids;
	}

	/** Канонические значения для всех операторов правил, независимо от формы передачи UF. */
	public static function value(mixed $value, bool $multiple): array
	{
		$files = [];
		foreach (self::entries($value, $multiple) as $entry)
		{
			if (!is_array($entry))
			{
				if (self::isId($entry)) $files[] = (string)(int)$entry;
				continue;
			}
			$oldIds = array_values(array_filter((array)($entry['old_id'] ?? []), [self::class, 'isId']));
			if (isset($entry['ID']) && !array_key_exists('old_id', $entry) && !array_key_exists('tmp_name', $entry) && !array_key_exists('del', $entry))
			{
				if (self::isId($entry['ID'])) $files[] = (string)(int)$entry['ID'];
				continue;
			}
			$deleted = !empty($entry['del']);
			$error = (int)($entry['error'] ?? UPLOAD_ERR_OK);
			if ($error !== UPLOAD_ERR_OK)
			{
				// FileType при отсутствии новой загрузки оставляет первый old_id, кроме del.
				if (!$deleted && $oldIds !== []) $files[] = (string)(int)$oldIds[0];
				continue;
			}
			if (!empty($entry['name']) && !empty($entry['tmp_name']))
			{
				$files[] = 'upload:' . hash('sha256', (string)$entry['tmp_name']);
			}
			elseif (!$deleted && !empty($entry['name']) && isset($entry['ID']) && in_array($entry['ID'], $oldIds))
			{
				$files[] = (string)(int)$entry['ID'];
			}
		}
		$files = array_values(array_unique($files));
		sort($files, SORT_STRING);
		return $files;
	}

	/**
	 * main.file.input оставляет ID в UF, а удаление присылает в <controlId>_deleted.
	 * Читаем только зарегистрированные для этого контрола ID. checkDeletedFiles()
	 * вызывать нельзя: он физически удаляет файл ещё до решения правила.
	 * Возвращаем отдельный набор операций для оценки и повторного сохранения из окна.
	 */
	public static function withRequestDeletions(array $before, array $changes, int $dealId): array
	{
		$request = Context::getCurrent()->getRequest()->getValues();
		if (isset($request['data']) && is_array($request['data'])) $request = $request['data'];
		$utility = FileInputUtility::instance();
		foreach (self::fields() as $id => $field)
		{
			$controlId = $utility->getUserFieldCid($field);
			$requested = $request[$controlId . '_deleted'] ?? [];
			$legacy = $request[$id . '_del'] ?? [];
			$present = array_key_exists($id, $changes);
			if (!$present && $requested === [] && $legacy === []) continue;
			$multiple = ($field['MULTIPLE'] ?? 'N') === 'Y';
			$oldIds = self::storedValue($before[$id] ?? null, $multiple);
			$deleted = is_array($requested) && $requested !== [] && $utility->isAccessible()
				? $utility->checkFiles($controlId, array_values(array_filter($requested, [self::class, 'isId']))) : [];
			$registeredCount = count($deleted);
			// CUserTypeManager читает также UF_..._del: ID, список ID или старые флаги Y.
			foreach ((array)$legacy as $key => $value)
			{
				if ($value === 'Y')
				{
					$value = $multiple ? (((array)($before[$id] ?? []))[$key] ?? null) : ($oldIds[0] ?? null);
				}
				if (self::isId($value) && in_array((string)(int)$value, $oldIds, true)) $deleted[] = $value;
			}
			$deleted = array_values(array_unique($deleted));
			$raw = $present ? $changes[$id] : ($before[$id] ?? null);
			$entries = self::entries($raw, $multiple);
			Diagnostics::detail('file.input', [
				'dealId' => $dealId, 'fieldId' => $id, 'controlId' => $controlId, 'multiple' => $multiple,
				'fieldInChanges' => $present, 'before' => Diagnostics::value($before[$id] ?? null),
				'proposed' => Diagnostics::value($raw), 'requestField' => Diagnostics::value($request[$id] ?? null),
				'controlDeleted' => $requested, 'legacyDeleted' => $legacy, 'acceptedDeleted' => $deleted,
			]);
			foreach ($entries as &$entry)
			{
				if (self::isId($entry) && in_array($entry, $deleted))
				{
					// Legacy-операция переживает границу AJAX-запросов; исходный _deleted — нет.
					$entry = ['old_id' => (int)$entry, 'del' => 'Y', 'error' => UPLOAD_ERR_NO_FILE,
						'name' => '', 'type' => '', 'tmp_name' => '', 'size' => 0];
				}
			}
			unset($entry);
			$changes[$id] = $multiple ? $entries : ($entries[0] ?? null);
			Diagnostics::write('file.state', [
				'dealId' => $dealId, 'fieldId' => $id, 'multiple' => $multiple,
				'deletionRequested' => (is_array($requested) && $requested !== []) || !empty($legacy),
				'registeredDeletions' => $registeredCount, 'acceptedDeletions' => count($deleted),
				'deleteOperations' => count(array_filter($entries,
					static fn ($entry): bool => is_array($entry) && !empty($entry['del']))),
				'previousCount' => count(self::value($before[$id] ?? null, $multiple)),
				'currentCount' => count(self::value($changes[$id], $multiple)),
			]);
		}
		return $changes;
	}

	private static function isId(mixed $value): bool
	{
		return (is_int($value) || (is_string($value) && ctype_digit($value))) && (int)$value > 0;
	}
}
