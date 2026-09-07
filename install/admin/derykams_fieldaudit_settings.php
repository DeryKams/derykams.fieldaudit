<?php
// Admin-стаб — копируется в /bitrix/admin/derykams_fieldaudit_settings.php
// при установке модуля. Просто подключает файл настроек из каталога модуля.
// Проверенный механизм derykams.colorfields: сам поднимает prolog и требует
// страницу из /local/modules/. B_PROLOG-защиту здесь НЕ ставим — файл
// открывается напрямую, prolog ещё не подключен, и die() давал белый экран.
require_once($_SERVER['DOCUMENT_ROOT'] . '/bitrix/modules/main/include/prolog_admin_before.php');

// Подключаем страницу настроек из модуля
require_once($_SERVER['DOCUMENT_ROOT'] . '/local/modules/derykams.fieldaudit/admin/settings.php');