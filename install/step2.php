<?php

// Шаг 2 установки: сообщение об успешной установке

use Bitrix\Main\Localization\Loc;

if (!defined('B_PROLOG_INCLUDED') || B_PROLOG_INCLUDED !== true)
{
	die();
}

Loc::loadMessages(__FILE__);

?>
<form action="<?= $APPLICATION->GetCurPage() ?>" method="get">
	<?= bitrix_sessid_post() ?>
	<p><?= Loc::getMessage('DERYKAMS_FA_INSTALL_OK') ?></p>
	<input type="hidden" name="lang" value="<?= LANGUAGE_ID ?>">
	<input type="submit" value="<?= Loc::getMessage('DERYKAMS_FA_BTN_BACK') ?>">
</form>