<?php

namespace Derykams\FieldAudit;

/** Снимок до операции — общий источник значений для обработчика и окна. */
final class DealState
{
	public static function load(int $id): array
	{
		$row = \CCrmDeal::GetListEx([], ['ID' => $id, 'CHECK_PERMISSIONS' => 'N'], false, false, ['*', 'UF_*'])->Fetch();
		if (!is_array($row)) throw new \RuntimeException('Сделка не найдена.');
		return $row;
	}

	public static function states(array $before, array $changes): array
	{
		$states = [];
		foreach (array_unique(array_merge(array_keys($before), array_keys($changes))) as $id)
		{
			$states[$id] = ['prev' => $before[$id] ?? null, 'curr' => array_key_exists($id, $changes) ? $changes[$id] : ($before[$id] ?? null)];
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
