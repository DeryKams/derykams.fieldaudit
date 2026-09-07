<?php

// Меню модуля в админке Битрикс24
// Добавляет пункт в раздел "Сервисы" (global_menu_services)
// Механизм проверенный в derykams.colorfields: guard на установленный модуль.

use Bitrix\Main\Localization\Loc;
use Bitrix\Main\Loader;

if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true)
{
	die();
}

Loc::loadMessages(__FILE__);

if (!Loader::includeModule('derykams.fieldaudit'))
{
	return false;
}

return [
	'parent_menu' => 'global_menu_services',
	'section' => 'derykams_fieldaudit',
	'sort' => 950,
	'text' => Loc::getMessage('DERYKAMS_FA_MENU_TEXT'),
	'title' => Loc::getMessage('DERYKAMS_FA_MENU_TITLE'),
	'items_id' => 'menu_derykams_fieldaudit',
	'items' => [
		[
			'text' => Loc::getMessage('DERYKAMS_FA_MENU_ITEM_SETTINGS'),
			'url' => 'derykams_fieldaudit_settings.php?lang=' . LANGUAGE_ID,
			'title' => Loc::getMessage('DERYKAMS_FA_MENU_TITLE'),
		],
	],
];