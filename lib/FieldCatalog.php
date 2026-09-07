<?php

namespace Derykams\FieldAudit;

final class FieldCatalog
{
	public static function get(): array
	{
		$fields = [
			'TITLE' => ['id' => 'TITLE', 'name' => 'Название сделки', 'type' => 'string', 'multiple' => false],
			'COMMENTS' => ['id' => 'COMMENTS', 'name' => 'Комментарий', 'type' => 'string', 'multiple' => false],
		];
		foreach ($GLOBALS['USER_FIELD_MANAGER']->GetUserFields('CRM_DEAL', 0, defined('LANGUAGE_ID') ? LANGUAGE_ID : 'ru') as $field)
		{
			$id = (string)$field['FIELD_NAME'];
			if ($id === 'UF_CRM_DELIVERY_SERVICE') continue;
			$fields[$id] = [
				'id' => $id,
				'name' => (string)($field['EDIT_FORM_LABEL'] ?: $field['LIST_COLUMN_LABEL'] ?: $id),
				'type' => (string)$field['USER_TYPE_ID'],
				'multiple' => ($field['MULTIPLE'] ?? 'N') === 'Y',
			];
			if ($fields[$id]['type'] === 'enumeration')
			{
				$enum = \CUserFieldEnum::GetList(['SORT' => 'ASC'], ['USER_FIELD_ID' => $field['ID']]);
				$fields[$id]['items'] = [];
				while ($item = $enum->Fetch()) $fields[$id]['items'][] = ['id' => (string)$item['ID'], 'name' => (string)$item['VALUE']];
			}
		}
		foreach ($fields as &$field)
		{
			$field['entity'] = 'Сделка';
			$field['editable'] = in_array($field['type'], ['string', 'file', 'integer', 'double', 'date', 'datetime', 'boolean', 'enumeration'], true);
		}
		unset($field);
		return $fields;
	}
}
