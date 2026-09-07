<?php

namespace Derykams\FieldAudit;

use Bitrix\Main\Loader;

/**
 * Обработчики событий сделки для движка правил.
 *
 * События (compatible-механизм, как в ядре):
 *
 *   OnBeforeCrmDealUpdate(&$arFields) — до сохранения; возврат false
 *        отменяет операцию, $arFields['RESULT_MESSAGE'] = текст ошибки.
 *        Действие fill (на уровне правила): сохранение блокируется,
 *        пока обязательные по правилу поля не заполнены.
 *
 *   OnAfterCrmDealUpdate(&$arFields) — после сохранения; действие bp
 *        (на уровне правила): запуск шаблона БП на документе сделки.
 *        Дедуплицировано: static-гвард за запрос + активные инстансы.
 *
 * Действие одно на правило (rule.action.type: 'bp'|'fill'), не на листе.
 * Для fill: окно блокирует перемещение, поля для него — из активных листьев.
 *
 * Значения prev/curr: prev — состояние в БД до сохранения (GetListEx),
 * curr — новые значения из $arFields, с фолбэком на текущие из БД.
 *
 * Все решения движка — в upload/derykams.fieldaudit.log.
 */
final class RuleHandler
{
	private const UF_ENTITY = 'CRM_DEAL';
	private const LOG_FILE = '/upload/derykams.fieldaudit.log';

	/** Предыдущие значения сохраняются до записи, в том числе для БП после записи. */
	private static array $snapshots = [];

	public static function onBeforeDealUpdate(array &$arFields): bool
	{
		$id = (int)($arFields['ID'] ?? 0);
		$rules = Options::get()['rules'] ?? [];
		if ($id <= 0) return true;
		if (!is_array($rules) || $rules === [] || !array_filter($rules, static fn ($rule) => is_array($rule) && ($rule['enabled'] ?? false)))
		{
			Diagnostics::write('rules.allow', ['dealId' => $id, 'reason' => 'no_enabled_rules']);
			return true;
		}
		unset(self::$snapshots[$id]);

		try
		{
			$before = DealState::load($id);
			$states = DealState::states($before, $arFields);
			$context = DealState::context($before, $arFields);
			Diagnostics::write('rules.begin', ['dealId' => $id] + $context);
			$requirements = RuleEngine::getFillRequirements($rules, $states, $context,
				static function (string $event, array $data) use ($id): void {
					Diagnostics::write($event, ['dealId' => $id] + $data);
				});
			if ($requirements === [])
			{
				self::$snapshots[$id] = ['states' => $states, 'context' => $context];
				Diagnostics::write('rules.allow', ['dealId' => $id, 'reason' => 'no_unmet_requirements']);
				return true;
			}

			$messages = [];
			foreach ($requirements as $requirement)
			{
				$prefix = $requirement['mode'] === 'any' ? 'Заполните хотя бы одно поле' : 'Заполните все поля';
				$messages[] = self::buildFillMessage($prefix, $requirement['fieldIds']);
			}
			$token = FillChallenge::create($id, $before, $arFields, $requirements);
			Integration::publishChallenge($token);
			$arFields['RESULT_MESSAGE'] = implode('; ', $messages)
				. ($token !== '' ? ' [DERYKAMS_FIELDAUDIT:' . $token . ']' : '');
			Diagnostics::write('rules.block', ['dealId' => $id, 'requirements' => $requirements,
				'challenge' => Diagnostics::tokenId($token), 'popupAvailable' => $token !== '']);
			return false;
		}
		catch (\Throwable $e)
		{
			self::log('onBefore: exception ' . $e->getMessage() . ' id=' . $id);
			Diagnostics::write('rules.error', ['dealId' => $id, 'exception' => get_class($e), 'message' => $e->getMessage()]);
			$arFields['RESULT_MESSAGE'] = 'Не удалось проверить правила заполнения. Повторите сохранение или обратитесь к администратору.';
			return false;
		}
	}

	/**
	 * OnAfterCrmDealUpdate: запускает БП по сработавшим bp-правилам.
	 */
	public static function onAfterDealUpdate(array &$arFields): bool
	{
		$id = (int)($arFields['ID'] ?? 0);
		if ($id <= 0)
		{
			return true;
		}

		try
		{
			$rules = Options::get()['rules'] ?? [];
			if (!is_array($rules) || $rules === [])
			{
				return true;
			}

			$snapshot = self::$snapshots[$id] ?? null;
			unset(self::$snapshots[$id]);
			if ($snapshot === null) return true;
			$states = $snapshot['states'];
			$context = $snapshot['context'];
			$triggered = RuleEngine::evaluateRules($rules, $states, $context);

			$launched = [];
			$skipped = [];
			foreach ($triggered as $item)
			{
				$action = $item['action'] ?? [];
				if (($action['type'] ?? '') !== 'bp')
				{
					continue;
				}

				$templateId = (int)($action['bpId'] ?? 0);
				if (self::startWorkflow($templateId, $id))
				{
					$launched[] = $templateId;
				}
				else
				{
					$skipped[] = $templateId;
				}
			}

			if ($launched !== [] || $skipped !== [])
			{
				self::log('onAfter: id=' . $id
					. ' triggered=' . count($triggered)
					. ' launched=[' . implode(',', $launched) . ']'
					. ' skipped=[' . implode(',', $skipped) . ']');
			}
		}
		catch (\Throwable $e)
		{
			self::log('onAfter: exception ' . $e->getMessage() . ' id=' . $id);
		}

		return true;
	}

	/**
	 * Запуск шаблона БП с дедупликацией.
	 */
	private static function startWorkflow(int $templateId, int $dealId): bool
	{
		if ($templateId <= 0 || !Loader::includeModule('bizproc') || !\CBPRuntime::isFeatureEnabled())
		{
			return false;
		}

		static $launched = [];
		$key = $dealId . ':' . $templateId;
		if (isset($launched[$key]))
		{
			return false;
		}

		$documentId = ['crm', 'CCrmDocumentDeal', 'DEAL_' . $dealId];

		try
		{
			$activeStates = \CBPDocument::getActiveStates($documentId);
			if (is_array($activeStates))
			{
				foreach ($activeStates as $state)
				{
					if ((int)($state['TEMPLATE_ID'] ?? 0) === $templateId)
					{
						$launched[$key] = true;
						return false;
					}
				}
			}
		}
		catch (\Throwable)
		{
		}

		$errors = [];
		\CBPDocument::StartWorkflow($templateId, $documentId, [], $errors);
		$launched[$key] = true;

		if ($errors !== [])
		{
			self::log('bp error: template=' . $templateId . ' deal=' . $dealId
				. ' ' . implode('; ', array_column($errors, 'message')));
		}

		return true;
	}

	/**
	 * Текст ошибки для RESULT_MESSAGE: заголовок окна + список полей.
	 */
	private static function buildFillMessage(string $title, array $fillFieldIds): string
	{
		$message = ($title !== '' ? $title : 'Заполните обязательные поля') . ': ';

		$labels = [];
		foreach ($fillFieldIds as $fieldId)
		{
			$labels[] = self::fieldLabel($fieldId);
		}

		return $message . implode(', ', $labels);
	}

	/**
	 * Человекочитаемое имя UF-поля (лейбл или ID).
	 */
	private static function fieldLabel(string $fieldId): string
	{
		if (!str_starts_with($fieldId, 'UF_'))
		{
			return $fieldId;
		}

		static $labels = null;
		if ($labels === null)
		{
			$labels = [];
			$userFields = $GLOBALS['USER_FIELD_MANAGER']->GetUserFields(self::UF_ENTITY, 0, defined('LANGUAGE_ID') ? LANGUAGE_ID : null);
			foreach ($userFields as $name => $field)
			{
				$field = (array)$field;
				$label = (string)($field['EDIT_FORM_LABEL'] ?? '');
				if ($label === '')
				{
					$label = (string)($field['LIST_COLUMN_LABEL'] ?? '');
				}
				if ($label === '')
				{
					$label = (string)($field['LIST_FILTER_LABEL'] ?? '');
				}

				$labels[$name] = $label !== '' ? $label : $name;
			}
		}

		return $labels[$fieldId] ?? $fieldId;
	}

	/**
	 * Журнал решений движка.
	 */
	private static function log(string $message): void
	{
		try
		{
			$root = (string)($_SERVER['DOCUMENT_ROOT'] ?? '');
			if ($root === '')
			{
				return;
			}

			@file_put_contents(
				$root . self::LOG_FILE,
				date('d.m.Y H:i:s') . ' ' . $message . "\n",
				FILE_APPEND
			);
		}
		catch (\Throwable)
		{
		}
	}
}
