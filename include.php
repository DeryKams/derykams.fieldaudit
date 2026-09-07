<?php

use Bitrix\Main\Loader;

Loader::registerAutoLoadClasses(
	'derykams.fieldaudit',
	array(
		'Derykams\FieldAudit\AuditLogTable' => 'lib/AuditLogTable.php',
		'Derykams\FieldAudit\Options' => 'lib/Options.php',
		'Derykams\FieldAudit\Tracker' => 'lib/Tracker.php',
		'Derykams\FieldAudit\RuleEngine' => 'lib/RuleEngine.php',
		'Derykams\FieldAudit\RuleHandler' => 'lib/RuleHandler.php',
		'Derykams\FieldAudit\SettingsController' => 'lib/SettingsController.php',
		'Derykams\FieldAudit\DealState' => 'lib/DealState.php',
		'Derykams\FieldAudit\FieldCatalog' => 'lib/FieldCatalog.php',
		'Derykams\FieldAudit\FillChallenge' => 'lib/FillChallenge.php',
		'Derykams\FieldAudit\FillController' => 'lib/FillController.php',
		'Derykams\FieldAudit\Integration' => 'lib/Integration.php',
		'Derykams\FieldAudit\RuleConfig' => 'lib/RuleConfig.php',
		'Derykams\FieldAudit\Diagnostics' => 'lib/Diagnostics.php',
	)
);
?>
