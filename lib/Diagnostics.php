<?php

namespace Derykams\FieldAudit;

/** Диагностика без содержимого CRM-полей и полных токенов окна. */
final class Diagnostics
{
	public static function tokenId(string $token): string
	{
		return substr($token, 0, 8);
	}

	public static function write(string $event, array $data = []): void
	{
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
