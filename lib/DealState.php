<?php

namespace Derykams\FieldAudit;

/** Снимок до операции — общий источник значений для обработчика и окна. */
final class DealState
{
	public static function load(int $id): array
	{
		$row = \CCrmDeal::GetListEx([], ['ID' => $id, 'CHECK_PERMISSIONS' => 'N'], false, false, ['*', 'UF_*'])->Fetch();
		if (!is_array($row)) throw new \RuntimeException('Сделка не найдена.');
		// GetUserFields декодирует VALUE_RAW/множественные значения штатным способом.
		$fileIds = array_keys(FileState::fields());
		if ($fileIds !== [])
		{
			$fields = $GLOBALS['USER_FIELD_MANAGER']->GetUserFields('CRM_DEAL', $id, false, false, $fileIds);
			foreach ($fields as $name => $field)
			{
				if (($field['USER_TYPE_ID'] ?? '') !== 'file') continue;
				$multiple = ($field['MULTIPLE'] ?? 'N') === 'Y';
				$value = $field['VALUE'] ?? null;
				Diagnostics::detail('file.database', ['dealId' => $id, 'fieldId' => $name,
					'listValue' => Diagnostics::value($row[$name] ?? null), 'userFieldValue' => Diagnostics::value($value)]);
				$stored = FileState::storedValue($value, $multiple);
				$row[$name] = $multiple ? $stored : ($stored[0] ?? null);
			}
		}
		return $row;
	}

	public static function states(array $before, array $changes): array
	{
		$states = [];
		foreach (array_unique(array_merge(array_keys($before), array_keys($changes))) as $id)
		{
			$states[$id] = ['prev' => $before[$id] ?? null, 'curr' => array_key_exists($id, $changes) ? $changes[$id] : ($before[$id] ?? null)];
		}
		foreach (FileState::fields() as $id => $field)
		{
			if (!isset($states[$id])) continue;
			$multiple = ($field['MULTIPLE'] ?? 'N') === 'Y';
			$states[$id]['prev'] = FileState::value($states[$id]['prev'], $multiple);
			$states[$id]['curr'] = FileState::value($states[$id]['curr'], $multiple);
		}
		return $states;
	}

	public static function context(array $before, array $changes): array
	{
		return [
			'previousStageId' => (string)($before['STAGE_ID'] ?? ''),
			'stageId' => (string)($changes['STAGE_ID'] ?? $before['STAGE_ID'] ?? ''),
		];
	}
}
