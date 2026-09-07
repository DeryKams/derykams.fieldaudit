<?php

use Bitrix\Main\EventManager;
use Bitrix\Main\ModuleManager;

if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true)
{
	die();
}

/*
 * На странице установки модуль ещё не "loaded" по меркам Loader,
 * поэтому registerAutoLoadClasses (include.php) строит пути к lib/
 * через дефолтный holder "bitrix" и ищет классы в
 * /bitrix/modules/derykams.fieldaudit/lib — где их нет.
 * Подключаем классы напрямую по абсолютным путям.
 */
require_once __DIR__ . '/../lib/AuditLogTable.php';
require_once __DIR__ . '/../lib/Options.php';

/**
 * Установщик модуля derykams.fieldaudit.
 *
 * При установке создаёт ORM-таблицу лога и регистрирует
 * обработчики событий обновления CRM-сущностей в БД.
 */
class derykams_fieldaudit extends CModule
{
	public const MODULE_ID = 'derykams.fieldaudit';

	/** FQCN класса-обработчика событий */
	public const TRACKER_CLASS = 'Derykams\\FieldAudit\\Tracker';

	/** FQCN обработчика движка правил сделки */
	public const RULE_HANDLER_CLASS = 'Derykams\\FieldAudit\\RuleHandler';

	public $MODULE_ID;
	public $MODULE_VERSION;
	public $MODULE_VERSION_DATE;
	public $MODULE_NAME;
	public $MODULE_DESCRIPTION;
	public $PARTNER_NAME;
	public $PARTNER_URI;

	public function __construct()
	{
		global $arModuleVersion;

		$this->MODULE_ID = self::MODULE_ID;

		$arModuleVersion = [];
		include __DIR__ . '/../version.php';

		$this->MODULE_VERSION = $arModuleVersion['VERSION'] ?? '0.1.0';
		$this->MODULE_VERSION_DATE = $arModuleVersion['VERSION_DATE'] ?? '2026-09-07 00:00:00';
		$this->MODULE_NAME = GetMessage('DERYKAMS_FA_MODULE_NAME') ?: 'Field audit';
		$this->MODULE_DESCRIPTION = GetMessage('DERYKAMS_FA_MODULE_DESCRIPTION')
			?: 'Отслеживание изменений полей CRM-сущностей: старое и новое значение, автор и время.';
		$this->PARTNER_NAME = 'derykams';
		$this->PARTNER_URI = '';
	}

	public function DoInstall()
	{
		global $APPLICATION;

		try
		{
			if (!\Bitrix\Main\Loader::includeModule('crm'))
			{
				throw new \RuntimeException(GetMessage('DERYKAMS_FA_ERR_CRM_REQUIRED')
					?: 'Module crm is required');
			}

			if (!ModuleManager::isModuleInstalled($this->MODULE_ID))
			{
				ModuleManager::registerModule($this->MODULE_ID);
			}

			$this->InstallDb();
			$this->InstallFiles();
			$this->UnInstallEvents();
			$this->InstallEvents();

			$APPLICATION->IncludeAdminFile(
				'',
				__DIR__ . '/step2.php'
			);
		}
		catch (\Throwable $e)
		{
			if (ModuleManager::isModuleInstalled($this->MODULE_ID))
			{
				try { $this->UnInstallEvents(); } catch (\Throwable) {}
				ModuleManager::unRegisterModule($this->MODULE_ID);
			}
			$APPLICATION->ThrowException($e->getMessage());

			return false;
		}

		return true;
	}

	public function DoUninstall()
	{
		global $APPLICATION;

		try
		{
			$this->UnInstallEvents();
			$this->UnInstallFiles();

			// Таблицу лога и настройки намеренно НЕ удаляем автоматически,
			// чтобы не потерять собранный аудит. Ручная очистка — README.
			if (ModuleManager::isModuleInstalled($this->MODULE_ID))
			{
				ModuleManager::unRegisterModule($this->MODULE_ID);
			}

			LocalRedirect(
				'/bitrix/admin/partner_modules.php?lang=' . LANGUAGE_ID
				. '&uninstall=ok'
			);
		}
		catch (\Throwable $e)
		{
			$APPLICATION->ThrowException($e->getMessage());

			return false;
		}

		return true;
	}

	/**
	 * Копирует файлы модуля в общие директории портала:
	 * - admin-заглушку в /bitrix/admin/ (точка входа страницы настроек);
	 * - JS/CSS ассеты в /bitrix/js/derykams.fieldaudit/.
	 *
	 * Перед копированием старая копия сносится, чтобы не копить устаревшие файлы.
	 */
	public function InstallFiles()
	{
		// admin-заглушка
		CopyDirFiles(
			__DIR__ . '/admin',
			$_SERVER['DOCUMENT_ROOT'] . '/bitrix/admin',
			false,
			true
		);

		// JS/CSS ассеты: чистим старую копию, затем копируем свежую
		DeleteDirFilesEx('/bitrix/js/' . $this->MODULE_ID . '/');
		CopyDirFiles(
			__DIR__ . '/js/derykams.fieldaudit',
			$_SERVER['DOCUMENT_ROOT'] . '/bitrix/js/' . $this->MODULE_ID,
			false,
			true
		);

		return true;
	}

	/**
	 * Удаляет скопированные при установке файлы из общих директорий портала.
	 */
	public function UnInstallFiles()
	{
		DeleteDirFilesEx('/bitrix/js/' . $this->MODULE_ID . '/');
		DeleteDirFiles(
			__DIR__ . '/admin',
			$_SERVER['DOCUMENT_ROOT'] . '/bitrix/admin'
		);

		return true;
	}

	/**
	 * Создаёт таблицу лога через ORM (createDbTable).
	 */
	public function InstallDb()
	{
		$entity = \Derykams\FieldAudit\AuditLogTable::getEntity();

		$connection = \Bitrix\Main\Application::getInstance()->getConnection();
		if (!$connection->isTableExists($entity->getDBTableName()))
		{
			$entity->createDbTable();
		}
	}

	public function InstallEvents()
	{
		$em = EventManager::getInstance();
		$em->registerEventHandler('main', 'OnProlog', $this->MODULE_ID, 'Derykams\\FieldAudit\\Integration', 'onProlog');

		// смарт-процессы: общий обработчик на все SP
		$em->registerEventHandler(
			'crm',
			'onCrmDynamicItemUpdate',
			$this->MODULE_ID,
			self::TRACKER_CLASS,
			'onItemUpdate'
		);

		// движок правил на сделке (compatible-события ядра, механизм WithCancel)
		$em->registerEventHandlerCompatible('crm', 'OnBeforeCrmDealUpdate', $this->MODULE_ID,
			self::RULE_HANDLER_CLASS, 'onBeforeDealUpdate');
		$em->registerEventHandlerCompatible('crm', 'OnAfterCrmDealUpdate', $this->MODULE_ID,
			self::RULE_HANDLER_CLASS, 'onAfterDealUpdate');

		return true;
	}

	public function UnInstallEvents()
	{
		$em = EventManager::getInstance();
		$em->unRegisterEventHandler('main', 'OnProlog', $this->MODULE_ID, 'Derykams\\FieldAudit\\Integration', 'onProlog');

		$em->unRegisterEventHandler(
			'crm',
			'onCrmDynamicItemUpdate',
			$this->MODULE_ID,
			self::TRACKER_CLASS,
			'onItemUpdate'
		);

		/* unRegisterEventHandler снимает запись без фильтра по VERSION,
		   поэтому подходит и для compatible-обработчиков. */
		$em->unRegisterEventHandler('crm', 'OnBeforeCrmDealUpdate', $this->MODULE_ID,
			self::RULE_HANDLER_CLASS, 'onBeforeDealUpdate');
		$em->unRegisterEventHandler('crm', 'OnAfterCrmDealUpdate', $this->MODULE_ID,
			self::RULE_HANDLER_CLASS, 'onAfterDealUpdate');

		return true;
	}
}
