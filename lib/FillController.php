<?php

namespace Derykams\FieldAudit;

use Bitrix\Main\Engine\ActionFilter;
use Bitrix\Main\Engine\Controller;
use Bitrix\Main\Error;
use Bitrix\Main\Loader;
use Bitrix\Main\Web\Json;

/** AJAX только для текущего пользователя и конкретной отклонённой операции. */
final class FillController extends Controller
{
	public function configureActions(): array
	{
		$filters = static fn () => [new ActionFilter\Authentication(), new ActionFilter\HttpMethod(['POST']), new ActionFilter\Csrf()];
		return ['load' => ['prefilters' => $filters()], 'save' => ['prefilters' => $filters()], 'trace' => ['prefilters' => $filters()]];
	}

	public function traceAction(string $trace): ?array
	{
		try
		{
			if (!Loader::includeModule('crm')) throw new \RuntimeException('Модуль CRM недоступен.');
			return Diagnostics::readTrace($trace);
		}
		catch (\Throwable $e)
		{
			$this->addError(new Error($e->getMessage(), 'FIELDAUDIT_TRACE'));
			return null;
		}
	}

	public function loadAction(string $token): ?array
	{
		Diagnostics::write('popup.load.begin', ['challenge' => Diagnostics::tokenId($token)]);
		try
		{
			$challenge = $this->getAllowedChallenge($token);
			$catalog = FieldCatalog::get();
			$states = DealState::states($challenge['before'], $challenge['changes']);
			$fields = [];
			foreach ($challenge['requirements'] as $requirement)
			{
				foreach ($requirement['fieldIds'] as $id)
				{
					$field = $catalog[$id] ?? ['id' => $id, 'name' => $id, 'type' => 'unsupported', 'editable' => false];
					$value = $states[$id]['curr'] ?? '';
					$field['value'] = $field['type'] === 'file' ? '' : $value;
					$field['filled'] = RuleEngine::isFilled($value);
					if (in_array($field['type'], ['date', 'datetime'], true))
					{
						$convert = fn ($item) => $this->calendarValue($field, (string)($item ?? ''), true);
						$field['value'] = !empty($field['multiple']) ? array_map($convert, (array)$value) : $convert($value);
					}
					$fields[$id] = $field;
				}
			}
			Diagnostics::write('popup.load.ready', ['challenge' => Diagnostics::tokenId($token),
				'dealId' => $challenge['dealId'], 'fieldIds' => array_keys($fields),
				'requirements' => $challenge['requirements']]);
			return [
				'token' => $token, 'dealId' => $challenge['dealId'],
				'title' => 'Заполнение полей сделки', 'requirements' => $challenge['requirements'],
				'fields' => array_values($fields),
			];
		}
		catch (\Throwable $e)
		{
			$this->addError(new Error($e->getMessage(), 'FIELDAUDIT_LOAD'));
			Diagnostics::write('popup.load.error', ['challenge' => Diagnostics::tokenId($token), 'message' => $e->getMessage()]);
			return null;
		}
	}

	public function saveAction(string $token, string $valuesJson = '{}'): ?array
	{
		Diagnostics::write('popup.save.begin', ['challenge' => Diagnostics::tokenId($token)]);
		try
		{
			$challenge = $this->getAllowedChallenge($token);
			$before = DealState::load($challenge['dealId']);
			$changes = $challenge['changes'];
			$catalog = FieldCatalog::get();
			$values = Json::decode($valuesJson);
			if (!is_array($values)) throw new \RuntimeException('Некорректные значения полей.');
			$allowed = [];
			foreach ($challenge['requirements'] as $requirement)
			{
				foreach ($requirement['fieldIds'] as $id) $allowed[$id] = true;
			}
			foreach ($values as $id => $value)
			{
				if (!isset($allowed[$id], $catalog[$id]) || !$catalog[$id]['editable'] || $catalog[$id]['type'] === 'file')
				{
					throw new \RuntimeException('Поле недоступно для заполнения: ' . $id);
				}
				$changes[$id] = $this->normalizeValue($catalog[$id], $value);
			}
			foreach (array_keys($allowed) as $id)
			{
				if (($catalog[$id]['type'] ?? '') !== 'file') continue;
				$file = $this->getRequest()->getFile('upload_' . $id);
				if (!$file || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) continue;
				if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'] ?? ''))
				{
					throw new \RuntimeException('Не удалось загрузить файл «' . $catalog[$id]['name'] . '».');
				}
				$file['MODULE_ID'] = 'crm';
				// Файл сохраняется штатным обработчиком UF в составе обновления сделки.
				if ($catalog[$id]['multiple'])
				{
					// Сохраняем оставшиеся файлы и операции удаления из отклонённого запроса.
					$existing = array_key_exists($id, $changes) ? $changes[$id] : ($before[$id] ?? []);
					$changes[$id] = array_merge(FileState::entries($existing, true), [$file]);
				}
				else
				{
					if (!empty($before[$id])) $file['old_id'] = $before[$id];
					$changes[$id] = $file;
				}
			}

			$states = DealState::states($before, $changes);
			// Проверяем исходные требования: заполнение одного поля не отменяет режим «все».
			foreach ($challenge['requirements'] as $requirement)
			{
				if (!RuleEngine::requirementSatisfied($requirement, $states))
				{
					throw new \RuntimeException(($requirement['mode'] === 'any' ? 'Заполните хотя бы одно поле' : 'Заполните все поля') . ': ' . $requirement['title']);
				}
			}

			$deal = new \CCrmDeal(true);
			if (!$deal->Update($challenge['dealId'], $changes, true, true))
			{
				throw new \RuntimeException($deal->LAST_ERROR ?: 'Сделка не сохранена.');
			}
			FillChallenge::forget($token);
			Diagnostics::write('popup.save.done', ['challenge' => Diagnostics::tokenId($token),
				'dealId' => $challenge['dealId'], 'stageId' => $changes['STAGE_ID'] ?? $before['STAGE_ID']]);
			return ['saved' => true, 'dealId' => $challenge['dealId'], 'stageId' => $changes['STAGE_ID'] ?? $before['STAGE_ID']];
		}
		catch (\Throwable $e)
		{
			$this->addError(new Error($e->getMessage(), 'FIELDAUDIT_SAVE'));
			Diagnostics::write('popup.save.error', ['challenge' => Diagnostics::tokenId($token),
				'message' => preg_replace('/\[DERYKAMS_FIELDAUDIT:[a-f0-9]{48}\]/', '[challenge]', $e->getMessage())]);
			return null;
		}
	}

	private function getAllowedChallenge(string $token): array
	{
		if (!Loader::includeModule('crm')) throw new \RuntimeException('Модуль CRM недоступен.');
		$item = FillChallenge::get($token);
		if (!\CCrmDeal::CheckReadPermission($item['dealId']) || !\CCrmDeal::CheckUpdatePermission($item['dealId']))
		{
			throw new \RuntimeException('Нет прав на изменение сделки.');
		}
		if ($item['rulesHash'] !== FillChallenge::rulesHash())
		{
			throw new \RuntimeException('Правила изменились. Закройте окно и повторите перемещение сделки.');
		}
		$current = DealState::load($item['dealId']);
		// Не перезаписываем параллельные изменения; сохраняем только исходные изменённые поля.
		foreach ($item['before'] as $id => $value)
		{
			if (serialize($current[$id] ?? null) !== serialize($value))
			{
				throw new \RuntimeException('Сделка была изменена. Обновите страницу и повторите перемещение.');
			}
		}
		return $item;
	}

	private function normalizeValue(array $field, mixed $value): mixed
	{
		$items = $field['multiple'] ? $value : [$value];
		if (!is_array($items)) throw new \RuntimeException('Ожидается список значений: ' . $field['name']);
		$normalized = [];
		foreach ($items as $item)
		{
			if (!is_scalar($item) && $item !== null) throw new \RuntimeException('Некорректное значение: ' . $field['name']);
			$item = trim((string)$item);
			if ($item === '') continue;
			if (in_array($field['type'], ['date', 'datetime'], true)) $item = $this->calendarValue($field, $item, false);
			if ($field['type'] === 'integer' && !preg_match('/^-?\d+$/D', $item)) throw new \RuntimeException('Введите целое число: ' . $field['name']);
			if ($field['type'] === 'double' && !is_numeric($item)) throw new \RuntimeException('Введите число: ' . $field['name']);
			if ($field['type'] === 'boolean' && !in_array($item, ['0', '1'], true)) throw new \RuntimeException('Некорректное значение Да/Нет.');
			if ($field['type'] === 'enumeration' && !in_array($item, array_column($field['items'], 'id'), true)) throw new \RuntimeException('Значение списка не найдено.');
			$normalized[] = $item;
		}
		return $field['multiple'] ? $normalized : ($normalized[0] ?? '');
	}

	/** Обмен с date/datetime-local без перевода часового пояса браузера/сервера. */
	private function calendarValue(array $field, string $value, bool $toInput): string
	{
		if (trim($value) === '') return '';
		$isDate = $field['type'] === 'date';
		$portalFormat = $isDate ? \Bitrix\Main\Type\Date::getFormat() : \Bitrix\Main\Type\DateTime::getFormat();
		$inputFormat = $isDate ? 'Y-m-d' : 'Y-m-d\TH:i:s';
		$formats = $toInput ? [$portalFormat] : [$inputFormat];
		if (!$isDate) $formats[] = $toInput ? str_replace(':s', '', $portalFormat) : 'Y-m-d\TH:i';
		foreach (array_unique($formats) as $format)
		{
			$parsed = \DateTimeImmutable::createFromFormat('!' . $format, $value, new \DateTimeZone('UTC'));
			$errors = \DateTimeImmutable::getLastErrors();
			if ($parsed && (!$errors || (!$errors['warning_count'] && !$errors['error_count'])) && $parsed->format($format) === $value)
			{
				// Часовой пояс UF применит штатный DateTimeType::onBeforeSave ровно один раз.
				return $parsed->format($toInput ? $inputFormat : $portalFormat);
			}
		}
		throw new \RuntimeException('Некорректная дата' . ($isDate ? '' : ' и время') . ': ' . $field['name']);
	}
}
