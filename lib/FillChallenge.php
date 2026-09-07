<?php

namespace Derykams\FieldAudit;

use Bitrix\Main\Application;

/** Одноразовый контекст отклонённой операции, привязанный к сессии пользователя. */
final class FillChallenge
{
	private const KEY = 'derykams_fieldaudit_pending';
	private const TTL = 900;

	public static function create(int $id, array $before, array $proposed, array $requirements): string
	{
		global $USER;
		if (!is_object($USER) || !$USER->GetID()) return '';
		$changes = [];
		$info = \CCrmDeal::GetFieldsInfo();
		foreach ($proposed as $field => $value)
		{
			if (in_array($field, ['ID', 'DATE_CREATE', 'DATE_MODIFY', 'CREATED_BY_ID', 'MODIFY_BY_ID', 'RESULT_MESSAGE'], true)) continue;
			if (!isset($info[$field]) && !str_starts_with($field, 'UF_CRM_')) continue;
			if (in_array('readOnly', $info[$field]['ATTRIBUTES'] ?? [], true)) continue;
			if (serialize($value) !== serialize($before[$field] ?? null)) $changes[$field] = $value;
		}
		$session = Application::getInstance()->getSession();
		$pending = self::prune((array)$session->get(self::KEY));
		$token = bin2hex(random_bytes(24));
		$pending[$token] = [
			'userId' => (int)$USER->GetID(), 'dealId' => $id, 'created' => time(),
			'before' => $before, 'changes' => $changes, 'requirements' => $requirements,
			'rulesHash' => self::rulesHash(),
		];
		$session->set(self::KEY, array_slice($pending, -20, null, true));
		return $token;
	}

	public static function get(string $token): array
	{
		global $USER;
		$session = Application::getInstance()->getSession();
		$pending = self::prune((array)$session->get(self::KEY));
		$session->set(self::KEY, $pending);
		$item = $pending[$token] ?? null;
		if (!preg_match('/^[a-f0-9]{48}$/D', $token) || !$item || $item['userId'] !== (int)$USER->GetID())
		{
			throw new \RuntimeException('Окно устарело. Повторите перемещение сделки.');
		}
		return $item;
	}

	public static function forget(string $token): void
	{
		$session = Application::getInstance()->getSession();
		$pending = (array)$session->get(self::KEY);
		unset($pending[$token]);
		$session->set(self::KEY, $pending);
	}

	public static function rulesHash(): string
	{
		return hash('sha256', serialize(Options::get()['rules'] ?? []));
	}

	private static function prune(array $pending): array
	{
		return array_filter($pending, static fn ($item) => is_array($item) && ($item['created'] ?? 0) > time() - self::TTL);
	}
}
