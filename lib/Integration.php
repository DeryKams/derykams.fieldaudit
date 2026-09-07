<?php

namespace Derykams\FieldAudit;

use Bitrix\Main\EventManager;
use Bitrix\Main\Page\Asset;

final class Integration
{
	public const CHALLENGE_HEADER = 'X-Derykams-FieldAudit';
	private static array $responseTokens = [];

	/** Legacy SAVE_PROGRESS теряет RESULT_MESSAGE, поэтому сигнал передаётся также заголовком. */
	public static function publishChallenge(string $token): void
	{
		if ($token === '') return;
		if (headers_sent())
		{
			Diagnostics::write('challenge.header_failed', ['reason' => 'headers_sent', 'challenge' => Diagnostics::tokenId($token)]);
			return;
		}
		self::$responseTokens[$token] = $token;
		// Последние 20 соответствуют лимиту контекстов в сессии (в том числе массовый перенос).
		header(self::CHALLENGE_HEADER . ': ' . implode(',', array_slice(self::$responseTokens, -20)));
		Diagnostics::write('challenge.header_sent', ['challenge' => Diagnostics::tokenId($token)]);
	}

	/** Обновление существующей установки при открытии настроек администратором. */
	public static function sync(): void
	{
		$root = dirname(__DIR__);
		$target = $_SERVER['DOCUMENT_ROOT'] . '/bitrix/js/derykams.fieldaudit';
		foreach (['settings.js', 'settings.css', 'runtime.js', 'runtime.css'] as $name)
		{
			$source = $root . '/install/js/derykams.fieldaudit/' . $name;
			$destination = $target . '/' . $name;
			if (is_file($destination) && hash_file('sha256', $source) === hash_file('sha256', $destination)) continue;
			if (!CheckDirPath($target . '/') || !copy($source, $destination))
			{
				throw new \RuntimeException('Не удалось обновить ' . $destination . '. Проверьте права записи веб-сервера.');
			}
		}
		EventManager::getInstance()->registerEventHandler('main', 'OnProlog', Options::MODULE_ID, self::class, 'onProlog');
	}

	public static function onProlog(): void
	{
		global $USER;
		if (!is_object($USER) || !$USER->IsAuthorized()) return;
		$path = (string)parse_url($_SERVER['REQUEST_URI'] ?? '', PHP_URL_PATH);
		if (!preg_match('~/crm/deal/(?:details|kanban)/~', $path)) return;
		// Скрипт слушает только ответы с маркером модуля. При отсутствии правил не вмешивается.
		\CJSCore::Init(['ajax', 'popup']);
		Diagnostics::write('runtime.assets', ['files' => ['runtime.js', 'runtime.css']]);
		$base = '/bitrix/js/derykams.fieldaudit/';
		foreach (['runtime.js', 'runtime.css'] as $name)
		{
			$version = is_file($_SERVER['DOCUMENT_ROOT'] . $base . $name) ? filemtime($_SERVER['DOCUMENT_ROOT'] . $base . $name) : 0;
			$url = $base . $name . '?v=' . $version;
			if (str_ends_with($name, '.js')) Asset::getInstance()->addJs($url);
			else Asset::getInstance()->addCss($url);
		}
	}
}
