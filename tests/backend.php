<?php
// Запуск: php tests/backend.php. Изолированные контрактные тесты без установленного портала.
namespace Bitrix\Main\Web {
	class Json { public static function encode($v, $flags = 0) { return json_encode($v, $flags | JSON_THROW_ON_ERROR); } public static function decode($v) { return json_decode($v, true, 512, JSON_THROW_ON_ERROR); } }
}
namespace Bitrix\Main\Config {
	class Option { public static array $values = []; public static function get($module, $key, $default = '') { return self::$values[$key] ?? $default; } public static function set($module, $key, $value) { self::$values[$key] = $value; } }
}
namespace Bitrix\Main {
	class Loader { public static function includeModule($id) { return true; } }
	class Error { public function __construct(public string $message, public string $code = '') {} }
	class Application {
		private static $instance;
		public array $data = [];
		public static function getInstance() { return self::$instance ??= new self(); }
		public function getSession() { return $this; }
		public function get($key) { return $this->data[$key] ?? null; }
		public function set($key, $value) { $this->data[$key] = $value; }
	}
}
namespace Bitrix\Main\Engine {
	class Controller {
		public array $errors = [];
		protected function addError($error) { $this->errors[] = $error; }
		public function getRequest() { return new class { public function getFile($name) { return null; } }; }
	}
}
namespace {
	use Derykams\FieldAudit\{Options, RuleEngine, RuleConfig, RuleHandler, FillController, FillChallenge, DealState};
	foreach (['Options', 'RuleEngine', 'RuleConfig', 'RuleHandler', 'DealState', 'FieldCatalog', 'FillChallenge', 'FillController'] as $name) require __DIR__ . '/../lib/' . $name . '.php';

	class CCrmDeal {
		public static array $row = ['ID' => 6245, 'STAGE_ID' => 'NEW', 'TITLE' => 'Сделка', 'COMMENTS' => '', 'UF_CRM_A' => '', 'UF_CRM_B' => ''];
		public static bool $allowed = true;
		public static bool $rejectSave = false;
		public static int $reads = 0;
		public string $LAST_ERROR = '';
		public function __construct($checkPermissions = true) { if (!$checkPermissions) throw new \RuntimeException('Permissions disabled'); }
		public static function GetListEx(...$args) { ++self::$reads; return new class { public function Fetch() { return CCrmDeal::$row; } }; }
		public static function GetFieldsInfo() { return ['STAGE_ID' => [], 'TITLE' => [], 'COMMENTS' => []]; }
		public static function CheckReadPermission($id) { return self::$allowed; }
		public static function CheckUpdatePermission($id) { return self::$allowed; }
		public function Update($id, &$fields, ...$args) {
			if (self::$rejectSave) { $this->LAST_ERROR = 'Штатная проверка CRM'; return false; }
			$fields['ID'] = $id;
			if (!RuleHandler::onBeforeDealUpdate($fields)) { $this->LAST_ERROR = $fields['RESULT_MESSAGE']; return false; }
			self::$row = array_replace(self::$row, $fields);
			RuleHandler::onAfterDealUpdate($fields);
			return true;
		}
	}
	class CBPRuntime { public static function isFeatureEnabled() { return true; } }
	class CBPDocument {
		public static array $started = [];
		public static function getActiveStates($document) { return []; }
		public static function StartWorkflow($id, $doc, $args, &$errors) { self::$started[] = $id; }
	}
	$USER = new class { public int $id = 7; public function GetID() { return $this->id; } };
	$USER_FIELD_MANAGER = new class {
		public function GetUserFields(...$args) { return array_combine(['UF_CRM_A', 'UF_CRM_B'], array_map(static fn ($id) => ['FIELD_NAME' => $id, 'EDIT_FORM_LABEL' => $id, 'USER_TYPE_ID' => 'string', 'MULTIPLE' => 'N'], ['UF_CRM_A', 'UF_CRM_B'])); }
	};
	$count = 0;
	function check($condition, $message) { global $count; ++$count; if (!$condition) throw new \RuntimeException($message); }
	function field($id, $operator = 'not_filled') { return ['type' => 'field', 'fieldId' => $id, 'trigger' => str_starts_with($operator, 'changed') ? 'change' : 'fill', 'operator' => $operator]; }
	$rule = ['id' => 'test_rule', 'title' => 'Документы', 'enabled' => true, 'stageId' => 'C', 'stageMode' => 'changed_to', 'condition' => ['type' => 'group', 'logic' => 'and', 'children' => [field('UF_CRM_A'), field('UF_CRM_B')]], 'action' => ['type' => 'fill', 'fillMode' => 'any', 'fillFieldIds' => ['UF_CRM_A', 'UF_CRM_B'], 'fillWindowTitle' => 'Документы']];
	$empty = CCrmDeal::$row;
	$context = ['previousStageId' => 'NEW', 'stageId' => 'C'];
	$states = DealState::states($empty, ['STAGE_ID' => 'C']);
	check(count(RuleEngine::getFillRequirements([$rule], $states, $context)) === 1, 'Both empty on C must require fill');
	foreach ([['UF_CRM_A' => 'A'], ['UF_CRM_B' => 'B'], ['UF_CRM_A' => 'A', 'UF_CRM_B' => 'B']] as $values) {
		check(RuleEngine::getFillRequirements([$rule], DealState::states($empty, $values), $context) === [], 'One or both filled must pass');
	}
	check(RuleEngine::getFillRequirements([$rule], $states, ['previousStageId' => 'NEW', 'stageId' => 'D']) === [], 'Other stage passes');
	check(RuleEngine::getFillRequirements([$rule], $states, ['previousStageId' => 'C', 'stageId' => 'C']) === [], 'Same stage is not a transition');
	$currentRule = $rule; $currentRule['stageMode'] = 'is';
	check(count(RuleEngine::getFillRequirements([$currentRule], $states, ['previousStageId' => 'C', 'stageId' => 'C'])) === 1, 'Current-stage condition');
	$disabled = $rule; $disabled['enabled'] = false;
	check(RuleEngine::getFillRequirements([$disabled], $states, $context) === [], 'Disabled passes');
	$or = $rule; $or['condition']['logic'] = 'or';
	check(count(RuleEngine::evaluateRules([$or], $states, $context)[0]['activeLeafFieldIds']) === 2, 'OR includes all true branches');
	$nested = $rule; $nested['condition']['children'] = [$or['condition'], field('TITLE', 'filled')];
	check(count(RuleEngine::evaluateRules([$nested], $states, $context)) === 1, 'Nested AND/OR');
	check(RuleEngine::isFilled([17]), 'Non-empty multiple file must not throw missing Json class');
	check(!RuleEngine::isFilled([]), 'Empty multiple file');
	check(RuleEngine::isFilled('0'), 'Scalar zero is filled');
	$req = ['fieldIds' => ['UF_CRM_A', 'UF_CRM_B'], 'mode' => 'all'];
	check(!RuleEngine::requirementSatisfied($req, DealState::states($empty, ['UF_CRM_A' => 'A'])), 'All needs both');
	$req['mode'] = 'any';
	check(RuleEngine::requirementSatisfied($req, DealState::states($empty, ['UF_CRM_A' => 'A'])), 'Any accepts one');

	Options::set(['rules' => [$rule], 'entityTypeIds' => [128]]);
	Options::saveRules([]);
	check(Options::get()['rules'] === [] && Options::get()['entityTypeIds'] === [128], 'Save empty keeps other options');
	$payload = ['ID' => 6245, 'STAGE_ID' => 'C'];
	check(RuleHandler::onBeforeDealUpdate($payload) && CCrmDeal::$reads === 0, 'No rules: no blocking or DB read');
	RuleConfig::validate([$rule]);
	$invalid = $rule; $invalid['condition']['logic'] = 'xor';
	try { RuleConfig::validate([$invalid]); check(false, 'Invalid group accepted'); } catch (\InvalidArgumentException $e) { check(true, 'Schema rejected'); }

	function challenge(array $rule, array $extra = []): string {
		Options::saveRules([$rule]);
		$payload = ['ID' => 6245, 'STAGE_ID' => 'C'] + $extra;
		check(!RuleHandler::onBeforeDealUpdate($payload), 'Empty values block with a challenge');
		preg_match('/DERYKAMS_FIELDAUDIT:([a-f0-9]{48})/', $payload['RESULT_MESSAGE'], $match);
		check(isset($match[1]), 'Challenge marker for both transport formats');
		return $match[1];
	}
	$token = challenge($rule, ['TITLE' => 'Новое название']);
	$controller = new FillController();
	check(count($controller->loadAction($token)['fields']) === 2, 'Popup contains two fields');
	check($controller->saveAction($token, '{}') === null, 'Empty submission rejected');
	check(CCrmDeal::$row['STAGE_ID'] === 'NEW', 'Rejected submission does not move');
	check($controller->saveAction($token, '{"ASSIGNED_BY_ID":1}') === null, 'Cannot edit fields outside requirement');
	CCrmDeal::$allowed = false;
	check($controller->loadAction($token) === null, 'Read/update permissions checked');
	CCrmDeal::$allowed = true;
	$USER->id = 8;
	check($controller->loadAction($token) === null, 'Token bound to user');
	$USER->id = 7;
	CCrmDeal::$rejectSave = true;
	check($controller->saveAction($token, '{"UF_CRM_A":"Заполнено"}') === null, 'CRM errors preserved');
	CCrmDeal::$rejectSave = false;
	$result = $controller->saveAction($token, '{"UF_CRM_A":"Заполнено"}');
	check($result['saved'] && CCrmDeal::$row['STAGE_ID'] === 'C' && CCrmDeal::$row['UF_CRM_B'] === '', 'One alternative saves and moves');
	check(CCrmDeal::$row['TITLE'] === 'Новое название', 'Original changes preserved');
	check($controller->loadAction($token) === null, 'Token is single use');

	CCrmDeal::$row = $empty;
	$all = $rule; $all['action']['fillMode'] = 'all';
	$token = challenge($all);
	check($controller->saveAction($token, '{"UF_CRM_A":"A"}') === null, 'Original all-requirement persists after predicate changes');
	check($controller->saveAction($token, '{"UF_CRM_A":"A","UF_CRM_B":"B"}')['saved'], 'Both values satisfy all');
	CCrmDeal::$row = $empty;
	$token = challenge($rule);
	CCrmDeal::$row['COMMENTS'] = 'Параллельное изменение';
	check($controller->saveAction($token, '{"UF_CRM_A":"A"}') === null, 'Concurrent change not overwritten');
	CCrmDeal::$row = $empty;
	$token = challenge($rule);
	Options::saveRules([]);
	check($controller->saveAction($token, '{"UF_CRM_A":"A"}') === null, 'Changed rules invalidate challenge');
	check(RuleHandler::onBeforeDealUpdate($payload), 'No rules immediately disables block');

	$bp = $rule; $bp['condition']['children'] = [field('UF_CRM_A', 'changed')]; $bp['action'] = ['type' => 'bp', 'bpId' => 23];
	Options::saveRules([$bp]);
	$payload = ['STAGE_ID' => 'C', 'UF_CRM_A' => 'Changed'];
	check((new CCrmDeal())->Update(6245, $payload), 'BP update allowed');
	check(CBPDocument::$started === [23], 'BP compares pre-save values');
	echo "OK: $count backend assertions\n";
}
