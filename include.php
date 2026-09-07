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
	)
);
?>