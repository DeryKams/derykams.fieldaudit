<?php

namespace Derykams\FieldAudit;

use Bitrix\Main\Engine\Controller;
use Bitrix\Main\Loader;
use Bitrix\Main\Error;
use Bitrix\Main\Web\Json;

/**
 * AJAX-контроллер настроек: BX.ajax.runAction('derykams:fieldaudit.api.settings.save').
 *
 * Требует права на модуль (access permissions) и корректный sessid.
 */
class SettingsController extends Controller
{
	public function configureActions(): array
	{
		return [
			'save' => [
				'prefilters' => [
					new \Bitrix\Main\Engine\ActionFilter\HttpMethod(
						[\Bitrix\Main\Engine\ActionFilter\HttpMethod::HTTP_POST]
					),
					new \Bitrix\Main\Engine\ActionFilter\Csrf(),
				],
			],
		];
	}

	/**
	 * Сохраняет конфигурацию правил (JSON от UI) в b_option.
	 */
	public function saveAction(string $configJson): ?array
	{
		if (!check_bitrix_sessid())
		{
			$this->addError(new Error('Session expired', 'sessid'));

			return null;
		}

		if (!$this->isAllowed())
		{
			$this->addError(new Error('Access denied', 'access'));

			return null;
		}

		try
		{
			$config = Json::decode($configJson);
		}
		catch (\Throwable $e)
		{
			$this->addError(new Error('Invalid JSON: ' . $e->getMessage(), 'json'));

			return null;
		}

		if (!is_array($config) || !array_key_exists('rules', $config) || !is_array($config['rules']))
		{
			$this->addError(new Error('Config must contain rules array', 'schema'));

			return null;
		}

		Options::set(['rules' => $config['rules']]);

		return ['status' => 'success'];
	}

	/**
	 * Права: администратор или право W на модуль.
	 */
	private function isAllowed(): bool
	{
		global $USER;

		if (is_object($USER) && $USER->IsAdmin())
		{
			return true;
		}

		try
		{
			$rights = \CMain::GetUserRight('derykams.fieldaudit', false, true);

			return $rights >= 'W';
		}
		catch (\Throwable)
		{
			return false;
		}
	}
}