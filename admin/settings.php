<?php

/**
 * Страница настроек модуля derykams.fieldaudit.
 *
 * Встроена в штатную админку Битрикс: левое меню и шапка сохраняются.
 * Паттерн как в derykams.colorfields:
 *   prolog_admin_before -> логика (права, POST) -> prolog_admin_after -> контент -> epilog_admin.
 *
 * UI из примера UI/index.html обёрнут в контейнер .fa-root; весь CSS
 * отскоуплен под .fa-root, чтобы не конфликтовать со стилями админки.
 *
 * Точка входа: /bitrix/admin/derykams_fieldaudit_settings.php (заглушка
 * из install/admin/).
 */

use Bitrix\Main\Localization\Loc;
use Bitrix\Main\Loader;

require_once($_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/prolog_admin_before.php');

Loc::loadMessages(__FILE__);

/** @global CMain $APPLICATION */
global $APPLICATION;

if (!Loader::includeModule('derykams.fieldaudit'))
{
	$APPLICATION->ThrowException(Loc::getMessage('DERYKAMS_FA_MODULE_NOT_INSTALLED'));
	require($_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/epilog_admin.php');

	return;
}

if ($APPLICATION->GetGroupRight('derykams.fieldaudit') < 'W')
{
	$APPLICATION->AuthForm(Loc::getMessage('DERYKAMS_FA_ACCESS_DENIED'));
}

/* --- Обработка сохранения: POST config_json --- */
$request = \Bitrix\Main\Application::getInstance()->getContext()->getRequest();
$saved = ((string)$request->getQuery('saved') === '1');
$error = '';

if ($request->isPost() && check_bitrix_sessid())
{
	$json = trim((string)$request->getPost('config_json'));
	if ($json !== '')
	{
		try
		{
			$decoded = \Bitrix\Main\Web\Json::decode($json);
			if (is_array($decoded) && array_key_exists('rules', $decoded) && is_array($decoded['rules']))
			{
				\Derykams\FieldAudit\Options::set(['rules' => $decoded['rules']]);

				/* PRG: редирект, чтобы F5 не отправлял форму повторно */
				LocalRedirect($APPLICATION->GetCurPageParam('saved=1', ['saved']));
			}
			else
			{
				$error = Loc::getMessage('DERYKAMS_FA_ERR_JSON_NO_RULES');
			}
		}
		catch (\Throwable $e)
		{
			$error = Loc::getMessage('DERYKAMS_FA_ERR_JSON_INVALID', ['#MSG#' => $e->getMessage()]);
		}
	}
}

/* --- Каталоги для UI --- */

/**
 * Каталог полей сделки (строковые штатные + UF string/file).
 * Формат: [{id, name, type, entity}].
 */
function derykamsFieldauditCollectFieldCatalog(): array
{
	$fields = [
		[
			'id' => 'TITLE',
			'name' => Loc::getMessage('DERYKAMS_FA_FIELD_TITLE'),
			'type' => 'string',
			'entity' => Loc::getMessage('DERYKAMS_FA_ENTITY_DEAL'),
		],
		[
			'id' => 'COMMENTS',
			'name' => Loc::getMessage('DERYKAMS_FA_FIELD_COMMENTS'),
			'type' => 'string',
			'entity' => Loc::getMessage('DERYKAMS_FA_ENTITY_DEAL'),
		],
	];

	$userFields = $GLOBALS['USER_FIELD_MANAGER']->GetUserFields('CRM_DEAL', 0, LANGUAGE_ID);
	foreach ($userFields as $field)
	{
		$field = (array)$field;
		$fieldName = (string)($field['FIELD_NAME'] ?? '');
		if ($fieldName === '' || $fieldName === 'UF_CRM_DELIVERY_SERVICE')
		{
			continue;
		}

		$type = ($field['USER_TYPE_ID'] ?? '') === 'file' ? 'file' : 'string';

		/* Название: EDIT_FORM_LABEL -> LIST_COLUMN_LABEL -> LIST_FILTER_LABEL -> FIELD_NAME.
		   Лейблы появляются только если GetUserFields вызван с $LANG (JOIN b_user_field_lang). */
		$label = (string)($field['EDIT_FORM_LABEL'] ?? '');
		if ($label === '')
		{
			$label = (string)($field['LIST_COLUMN_LABEL'] ?? '');
		}
		if ($label === '')
		{
			$label = (string)($field['LIST_FILTER_LABEL'] ?? '');
		}

		$fields[] = [
			'id' => $fieldName,
			'name' => trim($label) !== '' ? trim($label) : $fieldName,
			'type' => $type,
			'entity' => Loc::getMessage('DERYKAMS_FA_ENTITY_DEAL'),
		];
	}

	return $fields;
}

/**
 * Каталог шаблонов БП для документа «Сделка».
 */
function derykamsFieldauditCollectWorkflowCatalog(): array
{
	$workflows = [];

	if (Loader::includeModule('bizproc'))
	{
		$rows = \Bitrix\Bizproc\Workflow\Template\Entity\WorkflowTemplateTable::getList([
			'select' => ['ID', 'NAME'],
			'filter' => [
				'=MODULE_ID' => 'crm',
				'=ENTITY' => 'CCrmDocumentDeal',
				'=DOCUMENT_TYPE' => 'DEAL',
			],
			'order' => ['SORT' => 'ASC', 'NAME' => 'ASC'],
		]);

		while ($row = $rows->fetch())
		{
			$workflows[] = [
				'id' => (string)$row['ID'],
				'name' => (string)$row['NAME'],
			];
		}
	}

	return $workflows;
}

/**
 * Каталог стадий воронок сделок (DEAL_STAGE): [{id, name, category}].
 * Нужен UI для выбора целевой стадии правила (гейт действия).
 */
function derykamsFieldauditCollectStageCatalog(): array
{
	$stages = [];

	try
	{
		$rows = \CCrmStatus::GetList(
			['SORT' => 'ASC', 'ID' => 'ASC'],
			['ENTITY_ID' => 'DEAL_STAGE', 'ACTIVE' => 'Y', 'CHECK_PERMISSIONS' => 'N']
		);
		while ($row = $rows->Fetch())
		{
			$statusId = (string)($row['STATUS_ID'] ?? '');
			if ($statusId === '')
			{
				continue;
			}

			$stages[] = [
				'id' => $statusId,
				'name' => trim((string)($row['NAME'] ?? '')) ?: $statusId,
				'category' => (int)($row['CATEGORY_ID'] ?? 0),
			];
		}
	}
	catch (\Throwable)
	{
	}

	return $stages;
}

$faConfig = [
	'fields' => derykamsFieldauditCollectFieldCatalog(),
	'workflows' => derykamsFieldauditCollectWorkflowCatalog(),
	'stages' => derykamsFieldauditCollectStageCatalog(),
	'rules' => \Derykams\FieldAudit\Options::get()['rules'] ?? [],
];

$faAssetsPath = '/bitrix/js/derykams.fieldaudit/';

/* Заголовок страницы в шапке админки */
$APPLICATION->SetTitle(Loc::getMessage('DERYKAMS_FA_PAGE_TITLE'));

/* CSS примера (отскоуплен под .fa-root) в <head> */
$APPLICATION->SetAdditionalCSS($faAssetsPath . 'settings.css');

/* BX нужен для settings.js: BX.ready + BX.message('bitrix_sessid') */
\Bitrix\Main\UI\Extension::load(['main.core']);

/* Пролог админки «после» — шапка, левое меню, начало контента */
require($_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/prolog_admin_after.php');

if ($saved)
{
	\CAdminMessage::ShowMessage(['MESSAGE' => Loc::getMessage('DERYKAMS_FA_SAVED'), 'TYPE' => 'OK']);
}
if ($error !== '')
{
	\CAdminMessage::ShowMessage(['MESSAGE' => $error, 'TYPE' => 'ERROR']);
}
?>

<div class="fa-root">
	<div class="app">
		<header class="app-header">
			<div>
				<h1 class="app-title"><?= Loc::getMessage('DERYKAMS_FA_PAGE_TITLE') ?></h1>
				<div class="app-subtitle"><?= Loc::getMessage('DERYKAMS_FA_PAGE_SUBTITLE') ?></div>
			</div>
			<div class="header-actions">
				<button class="ui-btn ui-btn-light" data-action="add-rule"><?= Loc::getMessage('DERYKAMS_FA_BTN_ADD_RULE') ?></button>
				<button class="ui-btn ui-btn-light" data-action="save-settings"><?= Loc::getMessage('DERYKAMS_FA_BTN_SAVE') ?></button>
				<button class="ui-btn ui-btn-primary" data-action="switch-tab" data-tab="simulator"><?= Loc::getMessage('DERYKAMS_FA_BTN_SIMULATOR') ?></button>
			</div>
		</header>

		<div class="main-card">
			<nav class="tabs" aria-label="<?= Loc::getMessage('DERYKAMS_FA_TABS_ARIA') ?>">
				<button class="tab" data-action="switch-tab" data-tab="analysis"><?= Loc::getMessage('DERYKAMS_FA_TAB_ANALYSIS') ?></button>
				<button class="tab active" data-action="switch-tab" data-tab="rules"><?= Loc::getMessage('DERYKAMS_FA_TAB_RULES') ?></button>
				<button class="tab" data-action="switch-tab" data-tab="simulator"><?= Loc::getMessage('DERYKAMS_FA_TAB_SIMULATOR') ?></button>
				<button class="tab" data-action="switch-tab" data-tab="json"><?= Loc::getMessage('DERYKAMS_FA_TAB_JSON') ?></button>
			</nav>

			<div class="tab-panels">
				<section class="tab-panel" id="tab-analysis"></section>
				<section class="tab-panel active" id="tab-rules"></section>
				<section class="tab-panel" id="tab-simulator"></section>
				<section class="tab-panel" id="tab-json"></section>
			</div>
		</div>
	</div>

	<div id="modalRoot"></div>
	<div id="toastContainer" class="toast-container"></div>
</div>

<script>
window.faConfig = <?= \Bitrix\Main\Web\Json::encode($faConfig, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_HEX_AMP) ?>;
</script>
<script src="<?= $faAssetsPath ?>settings.js"></script>

<?php
require($_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/epilog_admin.php');
