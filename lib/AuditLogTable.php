<?php

namespace Derykams\FieldAudit;

use Bitrix\Main\ORM\Data\DataManager;
use Bitrix\Main\ORM\Fields\IntegerField;
use Bitrix\Main\ORM\Fields\StringField;
use Bitrix\Main\ORM\Fields\TextField;
use Bitrix\Main\ORM\Fields\DatetimeField;
use Bitrix\Main\ORM\Fields\Validators\LengthValidator;
use Bitrix\Main\Type\DateTime;

/**
 * Лог изменений полей CRM-сущностей.
 *
 * Одна запись = одно изменённое поле:
 * старое значение, новое значение, кто и когда изменил.
 */
class AuditLogTable extends DataManager
{
	public static function getTableName(): string
	{
		return 'b_derykams_fieldaudit_log';
	}

	public static function getMap(): array
	{
		return [
			(new IntegerField('ID'))
				->configurePrimary(true)
				->configureAutocomplete(true),

			// entityTypeId CCrmOwnerType: 2 = Deal, >= 128 = смарт-процессы
			(new IntegerField('ENTITY_TYPE_ID'))
				->configureRequired(true),

			(new IntegerField('ENTITY_ID'))
				->configureRequired(true),

			(new StringField('FIELD_NAME'))
				->configureRequired(true)
				->configureSize(64)
				->addValidator(new LengthValidator(null, 64)),

			// старое значение (до сохранения)
			(new TextField('OLD_VALUE')),

			// новое значение (после сохранения)
			(new TextField('NEW_VALUE')),

			(new IntegerField('USER_ID')),

			(new DatetimeField('CREATED'))
				->configureRequired(true)
				->configureDefaultValue(static fn() => new DateTime()),
		];
	}
}