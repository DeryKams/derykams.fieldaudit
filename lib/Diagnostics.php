<?php

namespace Derykams\FieldAudit;

/** Краткий серверный журнал и отключаемая подробная диагностика в сессии пользователя. */
final class Diagnostics
{
	// false отключает сбор значений и передачу подробного лога в консоль.
	public const FIELD_DEBUG = true;
	public const DEBUG_HEADER = 'X-Derykams-FieldAudit-Debug';
	private const DEBUG_KEY = 'derykams_fieldaudit_debug';
	private static ?string $trace = null;
	private static array $fieldIds = [];

	public static function beginFields(int $dealId, array $rules): void
	{
		if (!self::FIELD_DEBUG || empty($GLOBALS['USER']) || !$GLOBALS['USER']->GetID()) return;
		try
		{
			$walk = static function (array $node) use (&$walk): void {
				if (!empty($node['fieldId'])) self::$fieldIds[(string)$node['fieldId']] = true;
				foreach ($node['children'] ?? [] as $child) if (is_array($child)) $walk($child);
			};
			foreach ($rules as $rule)
			{
				if (!is_array($rule) || empty($rule['enabled'])) continue;
				$walk($rule['condition'] ?? []);
				foreach ($rule['action']['fillFieldIds'] ?? [] as $id) self::$fieldIds[(string)$id] = true;
			}
			$session = \Bitrix\Main\Application::getInstance()->getSession();
			if (!$session->isAccessible() || headers_sent()) return;
			$traces = array_filter((array)$session->get(self::DEBUG_KEY), static fn ($item) => ($item['created'] ?? 0) > time() - 600);
			if (self::$trace === null)
			{
				self::$trace = bin2hex(random_bytes(16));
				$traces[self::$trace] = ['userId' => (int)$GLOBALS['USER']->GetID(), 'created' => time(),
					'dealIds' => [], 'records' => [], 'truncated' => false];
			}
			$traces[self::$trace]['dealIds'][$dealId] = $dealId;
			$session->set(self::DEBUG_KEY, array_slice($traces, -8, null, true));
			header(self::DEBUG_HEADER . ': ' . self::$trace);
		}
		catch (\Throwable) { /* Диагностика не влияет на сохранение. */ }
	}

	/** Подробные значения не пишутся в публичный upload-журнал. */
	public static function detail(string $event, array $data): void
	{
		if (!self::FIELD_DEBUG || self::$trace === null) return;
		if (isset($data['fieldId']) && !isset(self::$fieldIds[$data['fieldId']])) return;
		try
		{
			$session = \Bitrix\Main\Application::getInstance()->getSession();
			$traces = (array)$session->get(self::DEBUG_KEY);
			if (!isset($traces[self::$trace])) return;
			$item = &$traces[self::$trace];
			if (count($item['records']) < 200)
			{
				$item['records'][] = ['time' => date('c'), 'event' => $event, 'data' => self::limited($data)];
			}
			else $item['truncated'] = true;
			$session->set(self::DEBUG_KEY, $traces);
		}
		catch (\Throwable) { }
	}

	public static function value(mixed $value): array
	{
		return ['type' => get_debug_type($value), 'value' => self::limited($value)];
	}

	private static function limited(mixed $value, int $depth = 0): mixed
	{
		if ($depth > 6) return '[depth limit]';
		if (is_string($value)) return mb_substr($value, 0, 500);
		if (is_array($value))
		{
			$result = [];
			foreach (array_slice($value, 0, 30, true) as $key => $item)
			{
				$result[$key] = $key === 'tmp_name' ? (empty($item) ? '' : '[temporary file present]') : self::limited($item, $depth + 1);
			}
			if (count($value) > 30) $result['__truncated'] = true;
			return $result;
		}
		return is_object($value) ? '[object ' . get_class($value) . ']' : $value;
	}

	public static function fieldValues(int $dealId, array $before, array $proposed, array $states): void
	{
		if (!self::FIELD_DEBUG || self::$trace === null) return;
		foreach (array_keys(self::$fieldIds) as $id)
		{
			$data = ['dealId' => $dealId, 'fieldId' => $id, 'fieldInChanges' => array_key_exists($id, $proposed),
				'phase' => 'before_save',
				'before' => self::value($before[$id] ?? null), 'proposed' => self::value($proposed[$id] ?? null),
				'effective' => self::value($states[$id]['curr'] ?? null),
				'previousFilled' => RuleEngine::isFilled($states[$id]['prev'] ?? null),
				'currentFilled' => RuleEngine::isFilled($states[$id]['curr'] ?? null)];
			$data['transition'] = $data['previousFilled']
				? ($data['currentFilled'] ? 'remains_filled' : 'cleared')
				: ($data['currentFilled'] ? 'filled' : 'remains_empty');
			$field = FileState::fields()[$id] ?? null;
			if ($field)
			{
				$data['filesBefore'] = [];
				foreach (array_slice(FileState::storedValue($before[$id] ?? null, ($field['MULTIPLE'] ?? 'N') === 'Y'), 0, 10) as $fileId)
				{
					try { $file = \CFile::GetFileArray((int)$fileId); }
					catch (\Throwable) { $file = false; }
					$data['filesBefore'][] = ['id' => $fileId, 'exists' => (bool)$file,
						'name' => $file['ORIGINAL_NAME'] ?? null, 'size' => $file['FILE_SIZE'] ?? null];
				}
			}
			self::detail('field.values', $data);
		}
	}

	public static function readTrace(string $trace): array
	{
		if (!self::FIELD_DEBUG || !preg_match('/^[a-f0-9]{32}$/D', $trace)) throw new \RuntimeException('Диагностика отключена или запрос некорректен.');
		$traces = (array)\Bitrix\Main\Application::getInstance()->getSession()->get(self::DEBUG_KEY);
		$item = $traces[$trace] ?? null;
		if (!$item || $item['created'] < time() - 600 || $item['userId'] !== (int)$GLOBALS['USER']->GetID())
		{
			throw new \RuntimeException('Диагностическая запись устарела. Повторите сохранение.');
		}
		foreach ($item['dealIds'] as $id)
		{
			if (!\CCrmDeal::CheckReadPermission($id)) throw new \RuntimeException('Нет доступа к диагностике сделки.');
		}
		return ['trace' => $trace, 'records' => $item['records'], 'truncated' => $item['truncated']];
	}

	public static function tokenId(string $token): string
	{
		return substr($token, 0, 8);
	}

	public static function write(string $event, array $data = []): void
	{
		self::detail($event, $data);
		try
		{
			$root = (string)($_SERVER['DOCUMENT_ROOT'] ?? '');
			if ($root === '') return;
			$record = [
				'time' => date('c'), 'event' => $event,
				'path' => parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH),
				'data' => $data,
			];
			@file_put_contents($root . '/upload/derykams.fieldaudit.log',
				json_encode($record, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE) . "\n",
				FILE_APPEND | LOCK_EX);
		}
		catch (\Throwable)
		{
			// Недоступность журнала не меняет решение правила.
		}
	}
}
