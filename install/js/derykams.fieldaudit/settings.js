
(function(){
'use strict';

/* Каталоги приходят с бэкенда: window.faConfig.fields / .workflows / .stages */
var FIELD_CATALOG = (window.faConfig && window.faConfig.fields) ? window.faConfig.fields : [];
var BP_CATALOG = (window.faConfig && window.faConfig.workflows) ? window.faConfig.workflows : [];
var STAGE_CATALOG = (window.faConfig && window.faConfig.stages) ? window.faConfig.stages : [];

/* Операторы зависят от выбранного триггера. */
var OPERATORS = {
  change:[
    {value:'changed', label:'Изменилось', short:'изменилось'},
    {value:'changed_to_filled', label:'Изменилось и заполнено', short:'изменилось и заполнено'},
    {value:'changed_to_empty', label:'Изменилось и стало пустым', short:'изменилось и стало пустым'}
  ],
  fill:[
    {value:'filled', label:'Заполнено', short:'заполнено'},
    {value:'not_filled', label:'Не заполнено', short:'не заполнено'}
  ]
};

var appState = {
  activeTab:'rules',
  rules:[],
  confirmCallback:null,
};

var idCounter = 0;

function uid(prefix){
  idCounter = idCounter + 1;
  return prefix + '_' + Date.now().toString(36) + '_' + idCounter;
}

function escapeHtml(value){
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#39;');
}

function plural(n, forms){
  var abs = Math.abs(n) % 100;
  var n1 = abs % 10;
  if(abs > 10 && abs < 20) return forms[2];
  if(n1 > 1 && n1 < 5) return forms[1];
  if(n1 === 1) return forms[0];
  return forms[2];
}

function getField(id){
  for(var i=0;i<FIELD_CATALOG.length;i++){
    if(FIELD_CATALOG[i].id === id) return FIELD_CATALOG[i];
  }
  return null;
}

function getBp(id){
  for(var i=0;i<BP_CATALOG.length;i++){
    if(BP_CATALOG[i].id === id) return BP_CATALOG[i];
  }
  return null;
}

function getFieldName(id){
  var field = getField(id);
  return field ? field.name : 'Неизвестное поле';
}

function getOperator(value){
  var keys = Object.keys(OPERATORS);
  for(var i=0;i<keys.length;i++){
    var list = OPERATORS[keys[i]];
    for(var j=0;j<list.length;j++){
      if(list[j].value === value) return list[j];
    }
  }
  return null;
}

function operatorLabel(value){
  var op = getOperator(value);
  return op ? op.label : value;
}

function operatorShort(value){
  var op = getOperator(value);
  return op ? op.short : operatorLabel(value);
}

function optionHtml(value,label,selected,disabled){
  return '<option value="' + escapeHtml(value) + '"' +
    (selected ? ' selected' : '') +
    (disabled ? ' disabled' : '') + '>' +
    escapeHtml(label) + '</option>';
}

function createLeaf(fieldId, options){
  options = options || {};
  var field = getField(fieldId) || FIELD_CATALOG[0] || {id:'', name:''};
  var trigger = options.trigger || 'fill';
  var leaf = {
    id: uid('leaf'),
    type: 'leaf',
    fieldId: field.id,
    trigger: trigger,
    operator: options.operator || (trigger === 'change' ? 'changed' : 'not_filled')
  };
  normalizeLeaf(leaf);
  return leaf;
}

function createGroup(logic, children){
  return {
    id: uid('group'),
    type: 'group',
    logic: logic || 'and',
    children: children || []
  };
}

function createRule(title, logic, children){
  return {
    id: uid('rule'),
    title: title || 'Новое правило',
    enabled: true,
    expanded: true,
    root: createGroup(logic, children),
    stageIds: [],
    stageMode: 'changed_to',
    action: {
      type: 'fill',
      bpId: BP_CATALOG[0] ? BP_CATALOG[0].id : '',
      fillWindowTitle: 'Заполните хотя бы одно поле',
      fillMode: 'any',
      fillFieldIds: []
    }
  };
}

function loadRules(){
  /* Сохранённые правила с бэкенда */
  if(window.faConfig && window.faConfig.rules && window.faConfig.rules.length){
    return window.faConfig.rules.map(function(rule){
      var root = rule.condition ? reviveNode(rule.condition) : createGroup('and', []);
      var action = (rule.action && typeof rule.action === 'object') ? rule.action : {};
      return {
        id: rule.id || uid('rule'),
        title: rule.title || 'Новое правило',
        enabled: rule.enabled !== false,
        expanded: true,
        root: root,
        stageIds: ruleStageIds(rule),
        stageMode: rule.stageMode || 'changed_to',
        action: {
          type: action.type === 'bp' ? 'bp' : 'fill',
          bpId: action.bpId || (BP_CATALOG[0] ? BP_CATALOG[0].id : ''),
          fillWindowTitle: action.fillWindowTitle || 'Заполните обязательные поля',
          fillMode: action.fillMode === 'any' ? 'any' : 'all',
          fillFieldIds: Array.isArray(action.fillFieldIds) ? action.fillFieldIds.slice() : []
        }
      };
    });
  }

  return [];
}

function reviveNode(node){
  if(node.type === 'field'){
    var leaf = {
      id: uid('leaf'),
      type:'leaf',
      fieldId: node.fieldId,
      trigger: node.trigger,
      operator: node.operator
    };
    normalizeLeaf(leaf);
    return leaf;
  }
  return {
    id: uid('group'),
    type:'group',
    logic: node.logic === 'or' ? 'or' : 'and',
    children: (node.children || []).map(reviveNode)
  };
}

function cloneNode(node){
  if(node.type === 'leaf'){
    return {
      id: uid('leaf'),
      type:'leaf',
      fieldId: node.fieldId,
      trigger: node.trigger,
      operator: node.operator
    };
  }
  return {
    id: uid('group'),
    type:'group',
    logic: node.logic,
    children: node.children.map(cloneNode)
  };
}

function cloneRule(rule){
  return {
    id: uid('rule'),
    title: rule.title + ' (копия)',
    enabled: rule.enabled,
    expanded: true,
    root: cloneNode(rule.root),
    stageIds: ruleStageIds(rule),
    stageMode: rule.stageMode || 'changed_to',
    fillFieldsSource: rule.fillFieldsSource,
    action: JSON.parse(JSON.stringify(rule.action || {}))
  };
}

function findRuleById(ruleId){
  for(var i=0;i<appState.rules.length;i++){
    if(appState.rules[i].id === ruleId) return appState.rules[i];
  }
  return null;
}

function searchContext(node, nodeId, parent, index, rule, depth){
  if(node.id === nodeId){
    return {rule:rule, node:node, parent:parent, index:index, depth:depth};
  }
  if(node.type === 'group'){
    for(var i=0;i<node.children.length;i++){
      var found = searchContext(node.children[i], nodeId, node, i, rule, depth + 1);
      if(found) return found;
    }
  }
  return null;
}

function findNodeContext(nodeId){
  for(var i=0;i<appState.rules.length;i++){
    var rule = appState.rules[i];
    var ctx = searchContext(rule.root, nodeId, null, -1, rule, 0);
    if(ctx) return ctx;
  }
  return null;
}

function collectLeaves(node){
  if(!node) return [];
  if(node.type === 'leaf') return [node];
  var result = [];
  node.children.forEach(function(child){
    result = result.concat(collectLeaves(child));
  });
  return result;
}

function countNestedGroups(node){
  if(node.type !== 'group') return 0;
  var count = 0;
  node.children.forEach(function(child){
    if(child.type === 'group'){
      count = count + 1 + countNestedGroups(child);
    }
  });
  return count;
}

function hasEmptyGroup(node){
  if(node.type !== 'group') return false;
  if(node.children.length === 0) return true;
  return node.children.some(hasEmptyGroup);
}

function nextUnusedFieldId(rule){
  var used = collectLeaves(rule.root).map(function(leaf){ return leaf.fieldId; });
  for(var i=0;i<FIELD_CATALOG.length;i++){
    if(used.indexOf(FIELD_CATALOG[i].id) === -1) return FIELD_CATALOG[i].id;
  }
  return FIELD_CATALOG[0] ? FIELD_CATALOG[0].id : '';
}

function normalizeLeaf(leaf){
  // Не подменяем удалённое поле: валидатор попросит выбрать его заново.
  if(leaf.trigger !== 'change' && leaf.trigger !== 'fill') leaf.trigger = 'fill';

  var allowed = OPERATORS[leaf.trigger].map(function(item){ return item.value; });
  if(allowed.indexOf(leaf.operator) === -1){
    leaf.operator = leaf.trigger === 'fill' ? 'not_filled' : 'changed';
  }
}

function fillFieldsForRule(rule){
  var ids = (rule.action && rule.action.fillFieldIds) || [];
  if(!ids.length) ids = collectLeaves(rule.root).filter(function(leaf){ return leaf.operator === 'not_filled'; }).map(function(leaf){ return leaf.fieldId; });
  return ids.filter(function(id, index){ return ids.indexOf(id) === index; }).map(getField).filter(Boolean);
}

function nodeText(node, isRoot){
  if(node.type === 'leaf'){
    return getFieldName(node.fieldId) + ' — ' + operatorShort(node.operator);
  }
  if(!node.children.length) return 'условия не заданы';

  var parts = node.children.map(function(child){
    return nodeText(child, false);
  });
  var joined = parts.join(node.logic === 'and' ? ' И ' : ' ИЛИ ');
  return isRoot ? joined : '(' + joined + ')';
}

function groupHint(group){
  var childCount = group.children.length;
  if(childCount === 0){
    return 'Группа пустая. Добавьте поле или вложенную группу.';
  }
  if(childCount === 1){
    return 'Для сложного условия добавьте минимум 2 элемента. Сейчас условие простое.';
  }

  var hasNested = group.children.some(function(child){ return child.type === 'group'; });
  var directLeaves = group.children.filter(function(child){ return child.type === 'leaf'; });
  var allRequiredFill = !hasNested &&
    directLeaves.length === childCount &&
    directLeaves.every(function(leaf){
      return leaf.operator === 'not_filled';
    });

  var fieldsWord = plural(childCount, ['поле','поля','полей']);

  if(allRequiredFill){
    if(group.logic === 'and'){
      return 'Окно заполнения откроется, только если все ' + childCount + ' ' + fieldsWord +
        ' не заполнены. Если хотя бы одно поле заполнено, проверка не срабатывает.';
    }
    return 'Окно заполнения откроется, если хотя бы одно из ' + childCount + ' ' + fieldsWord + ' не заполнено.';
  }

  if(hasNested){
    return 'В группе есть вложенные условия. Связь «' + (group.logic === 'and' ? 'И' : 'ИЛИ') +
      '» применяется к прямым элементам группы, а вложенные группы вычисляются по их собственным связям.';
  }

  if(group.logic === 'and'){
    return 'Группа сработает, только если все условия внутри истинны.';
  }
  return 'Группа сработает, если хотя бы одно условие внутри истинно.';
}

function ruleActionBadges(rule){
  var action = rule.action || {};
  if(action.type === 'bp'){
    var bp = getBp(action.bpId);
    if(bp){
      return '<span class="ui-badge ui-badge-info">БП: ' + escapeHtml(bp.name) + '</span>';
    }
    return '<span class="ui-badge ui-badge-muted">Бизнес-процесс не выбран</span>';
  }
  var names = fillFieldsForRule(rule).map(function(field){ return field.name; });
  return '<span class="ui-badge ui-badge-danger">Окно заполнения: ' +
    escapeHtml((action.fillMode === 'any' ? 'хотя бы одно — ' : 'все — ') + (names.join(', ') || 'поля не выбраны')) + '</span>';
}

function validateRule(rule){
  var errors = [];
  var warnings = [];
  var leaves = collectLeaves(rule.root);

  if(!rule.title.trim()) errors.push('Укажите название правила.');
  if(leaves.length === 0) errors.push('Добавьте хотя бы одно поле.');
  if(leaves.length === 1) warnings.push('Для сложных условий И/ИЛИ нужно минимум 2 поля.');
  if(hasEmptyGroup(rule.root)) errors.push('Есть пустая группа условий.');

  leaves.forEach(function(leaf){
    var field = getField(leaf.fieldId);
    if(!field) errors.push('Поле ' + leaf.fieldId + ' не найдено.');
  });

  var action = rule.action || {};
  if(action.type === 'bp' && !getBp(action.bpId)){
    errors.push('Не выбран бизнес-процесс для действия правила.');
  }
  if(ruleStageIds(rule).some(function(id){ return !STAGE_CATALOG.some(function(stage){ return stage.id === id; }); })) errors.push('Одна из выбранных стадий не найдена.');
  if(action.type === 'fill' && !fillFieldsForRule(rule).length) errors.push('Укажите поля для окна заполнения или добавьте условия «Не заполнено».');
  if(action.type === 'fill'){
    if(rule.fillFieldsSource === 'manual' && !(action.fillFieldIds || []).length){
      errors.push('Выберите хотя бы одно поле для ручного списка заполнения.');
    }
    var fillLeaves = leaves.filter(function(leaf){ return leaf.operator === 'not_filled'; });
    if(!fillLeaves.length){
      warnings.push('Для окна заполнения нет полей в состоянии «Не заполнено».');
    }
  }

  var counts = {};
  leaves.forEach(function(leaf){
    counts[leaf.fieldId] = (counts[leaf.fieldId] || 0) + 1;
  });
  Object.keys(counts).forEach(function(fieldId){
    if(counts[fieldId] > 1){
      warnings.push('Поле ' + getFieldName(fieldId) + ' используется ' + counts[fieldId] +
        ' раз. Проверьте, не конфликтует ли логика.');
    }
  });

  return {errors:errors, warnings:warnings};
}

function validateAll(){
  var errors = [];
  var warnings = [];
  // Пустой список — корректная настройка: контроль отключён.

  appState.rules.forEach(function(rule, index){
    if(!rule.enabled) return;
    var res = validateRule(rule);
    var label = rule.title.trim() || ('Правило ' + (index + 1));
    res.errors.forEach(function(item){ errors.push(label + ': ' + item); });
    res.warnings.forEach(function(item){ warnings.push(label + ': ' + item); });
  });

  return {errors:errors, warnings:warnings};
}

function validationAlertHtml(validation){
  var html = '';
  if(validation.errors.length){
    html += '<div class="ui-alert ui-alert-danger"><strong>Ошибки:</strong><ul class="alert-list">' +
      validation.errors.map(function(item){ return '<li>' + escapeHtml(item) + '</li>'; }).join('') +
      '</ul></div>';
  }
  if(validation.warnings.length){
    html += '<div class="ui-alert ui-alert-warning"><strong>Предупреждения:</strong><ul class="alert-list">' +
      validation.warnings.map(function(item){ return '<li>' + escapeHtml(item) + '</li>'; }).join('') +
      '</ul></div>';
  }
  if(!html){
    html = '<div class="ui-alert ui-alert-success">Ошибок и предупреждений не найдено.</div>';
  }
  return html;
}

function serializeNode(node){
  if(node.type === 'leaf'){
    return {
      type:'field',
      fieldId:node.fieldId,
      trigger:node.trigger,
      operator:node.operator
    };
  }
  return {
    type:'group',
    logic:node.logic,
    children:node.children.map(serializeNode)
  };
}

function serialize(){
  return {
    module:'bitrix24-field-change-control',
    version:2,
    savedAt:new Date().toISOString(),
    rules: appState.rules.map(function(rule){
      return {
        id: rule.id,
        title: rule.title,
        enabled: rule.enabled,
        condition: serializeNode(rule.root),
        stageIds: ruleStageIds(rule),
        stageMode: rule.stageMode || 'changed_to',
        action: {
          type: (rule.action && rule.action.type === 'bp') ? 'bp' : 'fill',
          bpId: (rule.action && rule.action.type === 'bp') ? (rule.action.bpId || null) : null,
          fillWindowTitle: (rule.action && rule.action.type !== 'bp') ? (rule.action.fillWindowTitle || null) : null,
          fillMode: (rule.action && rule.action.fillMode === 'any') ? 'any' : 'all',
          fillFieldIds: (rule.action && rule.action.fillFieldIds) || []
        }
      };
    })
  };
}

function fieldSelectHtml(leaf){
  var field = getField(leaf.fieldId) || {id:'', name:''};
  var display = field.name ? (field.name + ' — ' + field.id) : (field.id || '');

  return '<div class="fa-combo" data-node-id="' + leaf.id + '">' +
    '<input type="text" class="ui-input fa-combo-search" data-action="field-search"' +
      ' data-node-id="' + leaf.id + '" value="' + escapeHtml(display) + '"' +
      ' placeholder="Поиск поля по ID или названию" autocomplete="off">' +
    '<div class="fa-combo-dropdown" data-node-id="' + leaf.id + '"></div>' +
    '</div>';
}

function fieldComboEl(nodeId){
  return document.querySelector('.fa-combo[data-node-id="' + nodeId + '"]');
}

function fieldOptionsHtml(nodeId, query, selectedFieldId){
  var q = (query || '').toLowerCase().trim();
  var html = '';

  FIELD_CATALOG.forEach(function(f){
    var name = f.name || f.id;
    if(q && name.toLowerCase().indexOf(q) === -1 && f.id.toLowerCase().indexOf(q) === -1) return;

    html += '<div class="fa-combo-option' + (f.id === selectedFieldId ? ' selected' : '') + '"' +
      ' data-action="field-pick" data-node-id="' + nodeId + '" data-value="' + escapeHtml(f.id) + '">' +
      '<span class="fa-combo-opt-name">' + escapeHtml(name) + '</span>' +
      '<span class="fa-combo-opt-id">' + escapeHtml(f.id) + '</span>' +
      '<span class="fa-combo-opt-type' + (f.type === 'file' ? ' is-file' : '') + '">' +
        (f.type === 'file' ? 'Файл' : 'Строка') + '</span>' +
      '</div>';
  });

  return html || '<div class="fa-combo-empty">Совпадений нет</div>';
}

function openFieldDropdown(nodeId){
  var combo = fieldComboEl(nodeId);
  if(!combo) return;
  var dd = combo.faDropdown || combo.querySelector('.fa-combo-dropdown');
  if(dd.classList.contains('open')) return;

  var ctx = findNodeContext(nodeId);
  var selectedFieldId = (ctx && ctx.node.type === 'leaf') ? ctx.node.fieldId : '';

  dd.innerHTML = fieldOptionsHtml(nodeId, '', selectedFieldId);
  dd.classList.add('open');

  positionFieldDropdown(combo, dd);
}

// Keep the floating list outside layout containers so fixed coordinates use the viewport.
function positionFieldDropdown(combo, dd){
  combo.faDropdown = dd;
  combo.closest('.fa-root').appendChild(dd);
  var rect = combo.querySelector('.fa-combo-search').getBoundingClientRect();
  var viewport = window.visualViewport;
  var left = viewport ? viewport.offsetLeft : 0;
  var top = viewport ? viewport.offsetTop : 0;
  var viewportWidth = viewport ? viewport.width : window.innerWidth;
  var viewportHeight = viewport ? viewport.height : window.innerHeight;
  var width = Math.max(0, Math.min(Math.max(rect.width, 640), viewportWidth - 24));
  var below = Math.max(0, top + viewportHeight - rect.bottom - 16);
  var above = Math.max(0, rect.top - top - 16);
  var upwards = below < 200 && above > below;
  var height = Math.min(300, upwards ? above : below);
  dd.style.position = 'fixed';
  dd.style.width = width + 'px';
  dd.style.maxHeight = height + 'px';
  dd.style.left = Math.max(left + 12, Math.min(rect.left, left + viewportWidth - width - 12)) + 'px';
  dd.style.top = (upwards ? Math.max(top + 12, rect.top - dd.offsetHeight - 4) : rect.bottom + 4) + 'px';
}

function filterFieldDropdown(nodeId, query){
  var combo = fieldComboEl(nodeId);
  if(!combo) return;
  var ctx = findNodeContext(nodeId);
  var selectedFieldId = (ctx && ctx.node.type === 'leaf') ? ctx.node.fieldId : '';
  var dd = combo.faDropdown || combo.querySelector('.fa-combo-dropdown');
  dd.innerHTML = fieldOptionsHtml(nodeId, query, selectedFieldId);
  dd.classList.add('open');
  positionFieldDropdown(combo, dd);
}

function closeFieldDropdown(nodeId){
  var combo = fieldComboEl(nodeId);
  if(!combo) return;
  var dd = combo.faDropdown || combo.querySelector('.fa-combo-dropdown');
  dd.classList.remove('open');
  dd.innerHTML = '';
  combo.appendChild(dd);
  combo.faDropdown = null;
}

function resetFieldComboInput(combo){
  var nodeId = combo.dataset.nodeId;
  var ctx = findNodeContext(nodeId);
  var fieldId = (ctx && ctx.node.type === 'leaf') ? ctx.node.fieldId : '';
  var field = getField(fieldId) || {id: fieldId, name: ''};
  var input = combo.querySelector('.fa-combo-search');
  if(input) input.value = field.name ? (field.name + ' — ' + field.id) : (field.id || '');
}

function closeAllFieldDropdowns(){
  document.querySelectorAll('.fa-combo').forEach(function(combo){
    var dd = combo.faDropdown || combo.querySelector('.fa-combo-dropdown');
    if(dd.classList.contains('open')){
      closeFieldDropdown(combo.dataset.nodeId);
      resetFieldComboInput(combo);
    }
  });
}

function pickField(nodeId, fieldId){
  closeFieldDropdown(nodeId);
  setLeafProp(nodeId, 'fieldId', fieldId);
}

function triggerSelectHtml(leaf){
  return '<select class="ui-select" data-action="set-trigger" data-node-id="' + leaf.id + '">' +
    optionHtml('change','На изменение',leaf.trigger === 'change',false) +
    optionHtml('fill','На заполнение',leaf.trigger === 'fill',false) +
    '</select>';
}

function operatorSelectHtml(leaf){
  var list = OPERATORS[leaf.trigger] || [];
  return '<select class="ui-select" data-action="set-operator" data-node-id="' + leaf.id + '">' +
    list.map(function(op){
      return optionHtml(op.value, op.label, op.value === leaf.operator, false);
    }).join('') +
    '</select>';
}

function renderMoveButtons(node, ctx){
  if(ctx.isRoot || !ctx.parentCount || ctx.parentCount < 2) return '';
  return '<button class="ui-btn ui-btn-icon ui-btn-light ui-btn-xs" data-action="move-node" data-node-id="' + node.id +
      '" data-dir="up" title="Переместить выше" ' + (ctx.index === 0 ? 'disabled' : '') + '>↑</button>' +
    '<button class="ui-btn ui-btn-icon ui-btn-light ui-btn-xs" data-action="move-node" data-node-id="' + node.id +
      '" data-dir="down" title="Переместить ниже" ' + (ctx.index === ctx.parentCount - 1 ? 'disabled' : '') + '>↓</button>';
}

function renderTableHead(){
  return '<div class="cond-grid cond-table-head">' +
    '<div>№</div>' +
    '<div>Поле (ID)</div>' +
    '<div>Тип контроля</div>' +
    '<div>Проверяемое состояние</div>' +
    '<div>Операции</div>' +
    '</div>';
}

function renderConnector(group){
  var label = group.logic === 'and' ? 'И' : 'ИЛИ';
  var next = group.logic === 'and' ? 'or' : 'and';
  var cls = group.logic === 'and' ? '' : 'or';
  return '<div class="connector">' +
    '<button class="connector-badge ' + cls + '" data-action="set-logic" data-node-id="' + group.id +
    '" data-logic="' + next + '" title="Переключить связь между условиями">' + label + '</button>' +
    '</div>';
}

function renderGroupControls(node, ctx){
  var html = renderMoveButtons(node, ctx) +
    '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="add-leaf" data-node-id="' + node.id + '">+ Поле</button>' +
    '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="add-group" data-node-id="' + node.id + '">+ Группа</button>';

  if(!ctx.isRoot){
    html += '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="duplicate-node" data-node-id="' + node.id + '">Дублировать</button>' +
      '<button class="ui-btn ui-btn-danger ui-btn-sm" data-action="delete-node" data-node-id="' + node.id + '">Удалить</button>';
  }
  return html;
}

function renderGroup(node, rule, ctx){
  var leaves = collectLeaves(node);
  var logicLabel = node.logic === 'and' ? 'И' : 'ИЛИ';
  var childrenHtml = '';

  if(!node.children.length){
    childrenHtml = '<div class="empty">В группе пока нет условий. Добавьте поле или вложенную группу.</div>';
  } else {
    node.children.forEach(function(child, index){
      if(index > 0) childrenHtml += renderConnector(node);
      childrenHtml += renderNode(child, rule, {
        depth: ctx.depth + 1,
        index: index,
        parentCount: node.children.length,
        leafCounter: ctx.leafCounter,
        isRoot: false
      });
    });
  }

  return '<section class="group ' + (ctx.isRoot ? 'root' : 'nested') + ' logic-' + node.logic + '" data-node-id="' + node.id + '">' +
    '<div class="group-header">' +
      '<div class="group-title">' + (ctx.isRoot ? '1. Условия полей' : 'Вложенная группа') + '</div>' +
      '<div class="logic-switch">' +
        '<button class="logic-btn ' + (node.logic === 'and' ? 'active' : '') + '" data-action="set-logic" data-node-id="' + node.id + '" data-logic="and">И</button>' +
        '<button class="logic-btn ' + (node.logic === 'or' ? 'active' : '') + '" data-action="set-logic" data-node-id="' + node.id + '" data-logic="or">ИЛИ</button>' +
      '</div>' +
      '<div class="group-meta">' + leaves.length + ' ' + plural(leaves.length, ['поле','поля','полей']) + ' · связь ' + logicLabel + '</div>' +
      '<div class="group-controls">' + renderGroupControls(node, ctx) + '</div>' +
    '</div>' +
    '<div class="group-body">' +
      (ctx.isRoot ? renderTableHead() : '') +
      childrenHtml +
    '</div>' +
    '<div class="group-footer"><div class="group-hint">' + escapeHtml(groupHint(node)) + '</div></div>' +
    '</section>';
}

function renderLeaf(leaf, rule, ctx){
  var field = getField(leaf.fieldId) || FIELD_CATALOG[0] || {id:'', name:'Неизвестное поле'};
  var number = ++ctx.leafCounter.value;

  var operatorHint = leaf.trigger === 'change'
    ? 'Сравниваются старое и новое значение.'
    : 'Проверяется наличие значения.';

  return '<div class="cond-row cond-grid" data-node-id="' + leaf.id + '">' +
    '<div class="cond-cell cell-index" data-label="№"><span class="index-badge">' + number + '</span></div>' +

    '<div class="cond-cell" data-label="Поле (ID)">' +
      fieldSelectHtml(leaf) +
      '<div class="field-meta">' +
        '<span class="ui-badge ' + (field.type === 'file' ? 'ui-badge-warning' : 'ui-badge-info') + '">' +
          (field.type === 'file' ? 'Файл' : 'Строка') +
        '</span>' +
        '<span class="field-id">' + escapeHtml(field.id) + '</span>' +
      '</div>' +
    '</div>' +

    '<div class="cond-cell" data-label="Тип контроля">' +
      triggerSelectHtml(leaf) +
      '<div class="cell-hint">На изменение или на заполнение.</div>' +
    '</div>' +

    '<div class="cond-cell" data-label="Проверяемое состояние">' +
      operatorSelectHtml(leaf) +
      '<div class="cell-hint">' + escapeHtml(operatorHint) + '</div>' +
    '</div>' +

    '<div class="cond-cell" data-label="Операции">' +
      '<div class="cell-controls-inner">' +
        renderMoveButtons(leaf, ctx) +
        '<button class="ui-btn ui-btn-icon ui-btn-light ui-btn-xs" data-action="duplicate-node" data-node-id="' + leaf.id + '" title="Дублировать условие">⧉</button>' +
        '<button class="ui-btn ui-btn-icon ui-btn-danger ui-btn-xs" data-action="delete-node" data-node-id="' + leaf.id + '" title="Удалить условие">×</button>' +
      '</div>' +
    '</div>' +
    '</div>';
}

function renderNode(node, rule, ctx){
  return node.type === 'group' ? renderGroup(node, rule, ctx) : renderLeaf(node, rule, ctx);
}

function renderRuleSummaryInner(rule){
  var validation = validateRule(rule);
  return '<div class="summary-block">' +
      '<div class="summary-title">Формула условия</div>' +
      '<div class="summary-expression">' + escapeHtml(nodeText(rule.root, true) + stageConditionText(rule)) + '</div>' +
    '</div>' +
    '<div class="summary-block">' +
      '<div class="summary-title">Действия правила</div>' +
      '<div class="summary-actions">' + ruleActionBadges(rule) + '</div>' +
    '</div>' +
    '<div class="summary-block">' +
      '<div class="summary-title">Подсказка по логике</div>' +
      '<div class="group-hint">' + escapeHtml(groupHint(rule.root)) + '</div>' +
    '</div>' +
    validationAlertHtml(validation);
}

function ruleStageIds(rule){
  var ids = Array.isArray(rule.stageIds) ? rule.stageIds : (rule.stageId ? [rule.stageId] : []);
  return ids.filter(function(id, index){ return typeof id === 'string' && id !== '' && ids.indexOf(id) === index; });
}

function stageConditionText(rule){
  var ids = ruleStageIds(rule);
  if(!ids.length) return '';
  var names = ids.map(function(id){
    var stage = STAGE_CATALOG.find(function(item){ return item.id === id; });
    return stage ? (stage.categoryName ? stage.categoryName + ' / ' : '') + stage.name : id;
  });
  return ' И ' + ((rule.stageMode || 'changed_to') === 'changed_to' ? 'переход на одну из стадий: ' : 'стадия — одна из: ') + '(' + names.join(' ИЛИ ') + ')';
}

function stageSelectionText(rule){
  var count = ruleStageIds(rule).length;
  return count ? 'Выбрано стадий: ' + count : 'Без ограничения по стадии';
}

function renderStagePicker(rule){
  var selected = ruleStageIds(rule);
  var stages = STAGE_CATALOG.slice();
  // Сохранённую, но удалённую из CRM стадию можно снять вручную.
  selected.forEach(function(id){
    if(!stages.some(function(stage){ return stage.id === id; })) stages.push({id:id, name:'Стадия не найдена'});
  });
  return '<div class="fa-fill-fields fa-stage-picker">' +
    '<label>Выберите стадии<input type="search" class="ui-input" data-action="search-rule-stages" placeholder="Поиск по воронке, названию или ID стадии" autocomplete="off"></label>' +
    '<div class="fa-fill-fields-status" aria-live="polite"><span class="fa-fill-fields-count">' + stageSelectionText(rule) + '</span>' +
      '<span class="fa-fill-fields-found">Найдено: ' + stages.length + '</span></div>' +
    '<div class="fa-fill-fields-list" role="group" aria-label="Стадии проверки правила">' + stages.map(function(stage){
      var name = (stage.categoryName ? stage.categoryName + ' / ' : '') + stage.name;
      return '<label class="fa-fill-field-option" data-search="' + escapeHtml((name + ' ' + stage.id).toLowerCase()) + '">' +
        '<input type="checkbox" data-action="set-rule-stage" data-rule-id="' + escapeHtml(rule.id) + '" value="' + escapeHtml(stage.id) + '"' + (selected.indexOf(stage.id) >= 0 ? ' checked' : '') + '>' +
        '<span class="fa-fill-field-caption"><span>' + escapeHtml(name) + '</span><small>' + escapeHtml(stage.id) + '</small></span></label>';
    }).join('') + '<div class="fa-fill-fields-empty"' + (stages.length ? ' hidden' : '') + '>Стадии не найдены.</div></div></div>';
}

function renderStageCondition(rule){
  return '<div class="rule-stage-condition">' +
    '<div class="rule-section-title">2. Дополнительное условие: стадия сделки</div>' +
    '<div class="rule-stage-controls">' +
      '<label class="stage-mode">Когда проверять<select class="ui-select" data-action="set-rule-stage-mode" data-rule-id="' + rule.id + '">' +
        optionHtml('changed_to', 'Сделка переходит на одну из выбранных стадий', (rule.stageMode || 'changed_to') === 'changed_to', false) +
        optionHtml('is', 'Сделка находится на одной из выбранных стадий', rule.stageMode === 'is', false) +
      '</select></label>' +
      renderStagePicker(rule) +
    '</div><div class="cell-hint">Условия полей И любая из выбранных стадий. Если стадии не выбраны — без ограничения по стадии.</div>' +
    (!STAGE_CATALOG.length ? '<div class="ui-alert ui-alert-warning">Стадии не загружены. Проверьте доступность CRM и воронок.</div>' : '') +
    '</div>';
}

function renderFillFieldPicker(rule){
  var selected = rule.action.fillFieldIds || [];
  var fields = FIELD_CATALOG.filter(function(field){ return field.editable !== false; });
  return '<div class="fa-fill-fields">' +
    '<label>Выберите поля<input type="search" class="ui-input" data-action="search-rule-fill-fields" placeholder="Поиск по названию или ID поля" autocomplete="off"></label>' +
    '<div class="fa-fill-fields-status" aria-live="polite">' +
      '<span class="fa-fill-fields-count">Выбрано: ' + selected.length + '</span>' +
      '<span class="fa-fill-fields-found">Найдено: ' + fields.length + '</span>' +
    '</div>' +
    '<div class="fa-fill-fields-list" role="group" aria-label="Поля для окна заполнения">' +
      fields.map(function(field){
        return '<label class="fa-fill-field-option" data-search="' + escapeHtml((field.name + ' ' + field.id).toLowerCase()) + '">' +
          '<input type="checkbox" data-action="set-rule-fill-fields" data-rule-id="' + escapeHtml(rule.id) + '" value="' + escapeHtml(field.id) + '"' + (selected.indexOf(field.id) >= 0 ? ' checked' : '') + '>' +
          '<span class="fa-fill-field-caption"><span>' + escapeHtml(field.name) + '</span><small>' + escapeHtml(field.id) + '</small></span>' +
        '</label>';
      }).join('') +
      '<div class="fa-fill-fields-empty"' + (fields.length ? ' hidden' : '') + '>Поля не найдены.</div>' +
    '</div>' +
    '<div class="cell-hint">Отметьте нужные поля. Поиск не сбрасывает выбор.</div>' +
  '</div>';
}

function filterFillFieldPicker(input){
  var picker = input.closest('.fa-fill-fields');
  if(!picker) return;
  var terms = input.value.toLowerCase().trim().split(/\s+/).filter(Boolean);
  var found = 0;
  picker.querySelectorAll('.fa-fill-field-option').forEach(function(option){
    var matches = terms.every(function(term){ return option.dataset.search.indexOf(term) >= 0; });
    option.hidden = !matches;
    if(matches) found++;
  });
  picker.querySelector('.fa-fill-fields-found').textContent = 'Найдено: ' + found;
  picker.querySelector('.fa-fill-fields-empty').hidden = found > 0;
}

function renderRuleActionBlock(rule){
  var action = rule.action || {};
  var isBp = action.type === 'bp';
  var selected = action.fillFieldIds || [];
  var isManual = rule.fillFieldsSource === 'manual' || selected.length > 0;
  var params;
  if(isBp){
    params = '<label>Шаблон бизнес-процесса<select class="ui-select" data-action="set-rule-bp" data-rule-id="' + rule.id + '">' +
      optionHtml('', 'Выберите бизнес-процесс', !action.bpId, false) +
      BP_CATALOG.map(function(bp){ return optionHtml(bp.id, bp.name, bp.id === action.bpId, false); }).join('') + '</select></label>';
  } else {
    params = '<label>Условие продолжения<select class="ui-select" data-action="set-rule-fill-mode" data-rule-id="' + rule.id + '">' +
      optionHtml('any', 'Заполнить хотя бы одно из выбранных полей', action.fillMode === 'any', false) +
      optionHtml('all', 'Заполнить все выбранные поля', action.fillMode !== 'any', false) + '</select></label>' +
      '<div>Поля в окне заполнения</div><div class="fill-fields-source">' +
        '<label><input type="radio" name="fill-fields-source-' + rule.id + '" value="conditions"' + (isManual ? '' : ' checked') + ' data-action="set-rule-fill-source" data-rule-id="' + rule.id + '"> Из условий «Не заполнено»</label>' +
        '<label><input type="radio" name="fill-fields-source-' + rule.id + '" value="manual"' + (isManual ? ' checked' : '') + ' data-action="set-rule-fill-source" data-rule-id="' + rule.id + '"> Указать поля вручную</label>' +
      '</div>' +
      (isManual
        ? renderFillFieldPicker(rule)
        : '<div class="cell-hint">В окно попадут поля, для которых выше задано условие «Не заполнено».</div>') +
      '<label>Заголовок окна<input class="ui-input" type="text" value="' + escapeHtml(action.fillWindowTitle || '') + '" data-action="set-rule-fill-title" data-rule-id="' + rule.id + '"></label>';
  }
  return '<div class="rule-action-block">' +
    '<div class="rule-section-title">3. Одно действие для всего правила</div>' +
    '<div class="rule-action-row">' +
      '<label><input type="radio" name="rule-action-' + rule.id + '" value="fill"' + (isBp ? '' : ' checked') + ' data-action="set-rule-action" data-rule-id="' + rule.id + '"> Окно заполнения</label>' +
      '<label><input type="radio" name="rule-action-' + rule.id + '" value="bp"' + (isBp ? ' checked' : '') + ' data-action="set-rule-action" data-rule-id="' + rule.id + '"> Бизнес-процесс</label>' +
    '</div><div class="rule-action-params">' + params + '</div></div>';
}

function renderRuleCard(rule){
  var leaves = collectLeaves(rule.root);
  var nestedGroups = countNestedGroups(rule.root);

  return '<article class="rule-card ' + (rule.enabled ? '' : 'rule-disabled') + '" id="rule-' + rule.id + '">' +
    '<header class="rule-head">' +
      '<button class="ui-btn ui-btn-icon ui-btn-light" data-action="toggle-rule-body" data-rule-id="' + rule.id + '" aria-label="Свернуть или развернуть правило">' +
        (rule.expanded ? '▾' : '▸') +
      '</button>' +
      '<input class="rule-title-input" type="text" value="' + escapeHtml(rule.title) + '" placeholder="Название правила" data-action="set-rule-title" data-rule-id="' + rule.id + '">' +
      '<label class="ui-switch" title="Включить или отключить правило">' +
        '<input type="checkbox" data-action="toggle-rule" data-rule-id="' + rule.id + '" ' + (rule.enabled ? 'checked' : '') + '>' +
        '<span class="ui-switch-slider"></span>' +
      '</label>' +
      '<div class="rule-badges">' +
        '<span class="ui-badge ui-badge-muted">' + leaves.length + ' ' + plural(leaves.length, ['поле','поля','полей']) + '</span>' +
        '<span class="ui-badge ui-badge-muted">Вложенных групп: ' + nestedGroups + '</span>' +
        (rule.enabled
          ? '<span class="ui-badge ui-badge-success">Включено</span>'
          : '<span class="ui-badge ui-badge-warning">Отключено</span>') +
      '</div>' +
      '<div class="rule-controls">' +
        '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="duplicate-rule" data-rule-id="' + rule.id + '">Дублировать</button>' +
        '<button class="ui-btn ui-btn-danger ui-btn-sm" data-action="delete-rule" data-rule-id="' + rule.id + '">Удалить</button>' +
      '</div>' +
    '</header>' +
    '<div class="rule-body" style="display:' + (rule.expanded ? 'block' : 'none') + '">' +
      '<div class="builder"><div class="builder-inner">' +
        renderGroup(rule.root, rule, {
          depth:0,
          index:0,
          parentCount:1,
          isRoot:true,
          leafCounter:{value:0}
        }) +
      '</div></div>' +
      renderStageCondition(rule) +
      renderRuleActionBlock(rule) +
      '<div class="rule-summary" id="summary-' + rule.id + '">' + renderRuleSummaryInner(rule) + '</div>' +
    '</div>' +
    '</article>';
}

function renderRulesTab(){
  var html = '<div class="tab-toolbar">' +
      '<div>' +
        '<h2 class="section-title">Правила контроля полей</h2>' +
        '<p class="section-subtitle">Каждое правило — дерево условий. Поля остаются в табличных колонках, а связи И/ИЛИ вынесены в заголовок группы и коннекторы между строками.</p>' +
      '</div>' +
      '<div class="toolbar-actions">' +
        '<button class="ui-btn ui-btn-light" data-action="add-rule">+ Добавить правило</button>' +
        '<button class="ui-btn ui-btn-primary" data-action="save-settings">Сохранить настройки</button>' +
      '</div>' +
    '</div>';

  if(!appState.rules.length){
    html += '<div class="ui-alert ui-alert-warning">Правил нет — модуль не блокирует сохранение и перемещение сделок. Нажмите «Сохранить настройки», чтобы применить пустой список.</div>';
  } else {
    html += appState.rules.map(renderRuleCard).join('');
  }

  document.getElementById('tab-rules').innerHTML = html;
}

function refreshRules(){
  closeAllFieldDropdowns();
  var scrolls = {};
  document.querySelectorAll('.rule-card').forEach(function(card){
    var builder = card.querySelector('.builder');
    if(builder) scrolls[card.id] = builder.scrollLeft;
  });

  renderRulesTab();

  Object.keys(scrolls).forEach(function(cardId){
    var card = document.getElementById(cardId);
    if(card){
      var builder = card.querySelector('.builder');
      if(builder) builder.scrollLeft = scrolls[cardId];
    }
  });
}

function updateRuleSummary(ruleId){
  var rule = findRuleById(ruleId);
  var el = document.getElementById('summary-' + ruleId);
  if(rule && el) el.innerHTML = renderRuleSummaryInner(rule);
}

function renderAnalysisTab(){
  return '<div class="tab-inner">' +
    '<div class="section-card">' +
      '<h2 class="section-title">Анализ требований и компоновка UI</h2>' +
      '<p class="section-subtitle">Интерфейс рассчитан на настройку нескольких полей, триггеров, действий и логических связей И/ИЛИ.</p>' +
      '<div class="analysis-grid">' +
        '<div class="analysis-card">' +
          '<h3>1. Поля с ID</h3>' +
          '<p>Первая колонка — селектор пользовательских полей. Поля сгруппированы по типу: строки и файлы. В option видны название и ID формата <code class="code">UF_CRM_1768379972</code>. Под селектором ID дублируется крупным моноширинным текстом.</p>' +
        '</div>' +
        '<div class="analysis-card">' +
          '<h3>2. На изменение и на заполнение</h3>' +
          '<p>Вторая колонка задаёт тип контроля. Третья колонка уточняет состояние: изменилось, изменилось и заполнено, стало пустым, заполнено, не заполнено. Это позволяет строить условия, а не только фиксировать событие.</p>' +
        '</div>' +
        '<div class="analysis-card">' +
          '<h3>3. Действие</h3>' +
          '<p>Запуск бизнес-процесса доступен для обоих триггеров. Окно заполнения доступно только для триггера «На заполнение» и состояния «Не заполнено». UI автоматически блокирует некорректные комбинации.</p>' +
        '</div>' +
        '<div class="analysis-card">' +
          '<h3>4. И/ИЛИ между полями</h3>' +
          '<p>Логическая связь относится не к одному полю, а к группе строк. Поэтому переключатель И/ИЛИ вынесен в заголовок группы, а между строками показан коннектор. Вложенные группы позволяют задать приоритет операций.</p>' +
        '</div>' +
        '<div class="analysis-card">' +
          '<h3>5. Порядок настройки</h3>' +
          '<p>Слева направо: выбрали поле → указали тип контроля → уточнили состояние → выбрали действие → настроили параметр действия. Администратор проходит линейный сценарий без лишних модальных окон.</p>' +
        '</div>' +
        '<div class="analysis-card">' +
          '<h3>6. Контроль правильности</h3>' +
          '<p>Под каждым правилом выводится текстовая формула, действие и сообщения о некорректных настройках.</p>' +
        '</div>' +
      '</div>' +
    '</div>' +

    '<div class="section-card">' +
      '<h3 class="section-title">Матрица работы окна заполнения</h3>' +
      '<p class="section-subtitle">Пример из требований: два поля проверяются вместе. Если заполнено хотя бы одно из двух при связи И, проверка не срабатывает.</p>' +
      '<div class="table-scroll">' +
        '<table class="ui-table">' +
          '<thead><tr><th>Связь</th><th>Поле A</th><th>Поле B</th><th>Результат</th></tr></thead>' +
          '<tbody>' +
            '<tr><td>И</td><td>пусто</td><td>пусто</td><td>Открывается окно заполнения с полями A и B</td></tr>' +
            '<tr><td>И</td><td>заполнено</td><td>пусто</td><td>Проверка не срабатывает</td></tr>' +
            '<tr><td>И</td><td>пусто</td><td>заполнено</td><td>Проверка не срабатывает</td></tr>' +
            '<tr><td>И</td><td>заполнено</td><td>заполнено</td><td>Проверка не срабатывает</td></tr>' +
            '<tr><td>ИЛИ</td><td>пусто</td><td>пусто</td><td>Открывается окно с полями A и B</td></tr>' +
            '<tr><td>ИЛИ</td><td>заполнено</td><td>пусто</td><td>Открывается окно только с полем B</td></tr>' +
            '<tr><td>ИЛИ</td><td>пусто</td><td>заполнено</td><td>Открывается окно только с полем A</td></tr>' +
            '<tr><td>ИЛИ</td><td>заполнено</td><td>заполнено</td><td>Проверка не срабатывает</td></tr>' +
          '</tbody>' +
        '</table>' +
      '</div>' +
    '</div>' +

    '<div class="section-card">' +
      '<h3 class="section-title">Почему выбрана древовидная структура</h3>' +
      '<ul class="analysis-list">' +
        '<li>Плоская таблица не показывает приоритет операций между И и ИЛИ.</li>' +
        '<li>Группы визуально отделяют подвыражения, а коннекторы показывают связь между соседними условиями.</li>' +
        '<li>Действия собираются только из тех ветвей, которые оказались истинными при вычислении.</li>' +
        '<li>Структура масштабируется от двух полей до нескольких вложенных групп без изменения состава колонок.</li>' +
        '<li>Текстовая формула условия снижает риск неоднозначной настройки.</li>' +
      '</ul>' +
    '</div>' +
    '</div>';
}

function renderJsonTab(){
  var validation = validateAll();
  var json = serialize();

  return '<div class="tab-inner">' +
    '<div class="section-card">' +
      '<div class="section-head">' +
        '<div>' +
          '<h2 class="section-title">Конфигурация для сохранения</h2>' +
          '<p class="section-subtitle">Этот JSON можно передавать на бэкенд модуля или сохранять в настройках приложения.</p>' +
        '</div>' +
        '<div class="toolbar-actions">' +
          '<button class="ui-btn ui-btn-light" data-action="copy-json">Копировать</button>' +
          '<button class="ui-btn ui-btn-light" data-action="download-json">Скачать</button>' +
          '<button class="ui-btn ui-btn-primary" data-action="save-settings">Сохранить</button>' +
        '</div>' +
      '</div>' +
      validationAlertHtml(validation) +
      '<pre class="json-pre">' + escapeHtml(JSON.stringify(json, null, 2)) + '</pre>' +
    '</div>' +
    '</div>';
}

function renderTab(tab){
  if(tab === 'analysis'){
    document.getElementById('tab-analysis').innerHTML = renderAnalysisTab();
  }
  if(tab === 'rules'){
    renderRulesTab();
  }
  if(tab === 'json'){
    document.getElementById('tab-json').innerHTML = renderJsonTab();
  }
}

function switchTab(tab){
  if(['analysis', 'rules', 'json'].indexOf(tab) < 0) return;
  closeAllFieldDropdowns();
  appState.activeTab = tab;

  document.querySelectorAll('.tab').forEach(function(btn){
    btn.classList.toggle('active', btn.dataset.tab === tab);
  });

  document.querySelectorAll('.tab-panel').forEach(function(panel){
    panel.classList.toggle('active', panel.id === 'tab-' + tab);
  });

  renderTab(tab);
}

function toast(message, type){
  var container = document.getElementById('toastContainer');
  var el = document.createElement('div');
  el.className = 'toast toast-' + (type || 'info');
  el.textContent = message;
  container.appendChild(el);

  setTimeout(function(){
    el.classList.add('hide');
    setTimeout(function(){
      if(el.parentNode) el.parentNode.removeChild(el);
    }, 220);
  }, 3600);
}

function openModal(options){
  var root = document.getElementById('modalRoot');
  root.innerHTML =
    '<div class="modal-backdrop" data-action="close-modal">' +
      '<div class="modal ' + (options.size || '') + '" role="dialog" aria-modal="true">' +
        '<div class="modal-header">' +
          '<h3>' + escapeHtml(options.title || '') + '</h3>' +
          '<button class="ui-btn ui-btn-icon ui-btn-light" data-action="close-modal" aria-label="Закрыть">×</button>' +
        '</div>' +
        '<div class="modal-body">' + options.content + '</div>' +
        (options.footer ? '<div class="modal-footer">' + options.footer + '</div>' : '') +
      '</div>' +
    '</div>';

  document.body.classList.add('modal-open');
  if(options.onMount) options.onMount();
}

function closeModal(){
  document.getElementById('modalRoot').innerHTML = '';
  document.body.classList.remove('modal-open');
  appState.confirmCallback = null;
}

function openConfirm(title, text, onConfirm){
  appState.confirmCallback = onConfirm;
  openModal({
    title:title,
    content:'<div class="ui-alert ui-alert-warning">' + escapeHtml(text) + '</div>',
    footer:'<button class="ui-btn ui-btn-light" data-action="close-modal">Отмена</button>' +
      '<button class="ui-btn ui-btn-danger" data-action="confirm-yes">Подтвердить</button>'
  });
}

function openValidationModal(title, errors, warnings){
  var content = '';
  if(errors.length){
    content += '<div class="ui-alert ui-alert-danger"><strong>Ошибки:</strong><ul class="alert-list">' +
      errors.map(function(item){ return '<li>' + escapeHtml(item) + '</li>'; }).join('') +
      '</ul></div>';
  }
  if(warnings.length){
    content += '<div class="ui-alert ui-alert-warning"><strong>Предупреждения:</strong><ul class="alert-list">' +
      warnings.map(function(item){ return '<li>' + escapeHtml(item) + '</li>'; }).join('') +
      '</ul></div>';
  }
  if(!content){
    content = '<div class="ui-alert ui-alert-success">Ошибок нет.</div>';
  }

  openModal({
    title:title,
    content:content,
    footer:'<button class="ui-btn ui-btn-primary" data-action="close-modal">Понятно</button>'
  });
}

function addRule(){
  var leaf = createLeaf(nextUnusedFieldId({root:createGroup('and',[])}));
  var rule = createRule('Новое правило', 'and', [leaf]);
  appState.rules.push(rule);

  if(appState.activeTab !== 'rules') switchTab('rules');
  else refreshRules();

  toast('Правило добавлено', 'success');

  setTimeout(function(){
    var card = document.getElementById('rule-' + rule.id);
    if(card) card.scrollIntoView({behavior:'smooth', block:'center'});
  }, 60);
}

function toggleRule(ruleId, enabled){
  var rule = findRuleById(ruleId);
  if(!rule) return;
  rule.enabled = enabled;
  refreshRules();

}

function toggleRuleBody(ruleId){
  var rule = findRuleById(ruleId);
  if(!rule) return;
  rule.expanded = !rule.expanded;

  var card = document.getElementById('rule-' + ruleId);
  if(card){
    var body = card.querySelector('.rule-body');
    var btn = card.querySelector('[data-action="toggle-rule-body"]');
    if(body) body.style.display = rule.expanded ? 'block' : 'none';
    if(btn) btn.textContent = rule.expanded ? '▾' : '▸';
  }
}

function duplicateRule(ruleId){
  var rule = findRuleById(ruleId);
  if(!rule) return;

  var clone = cloneRule(rule);
  var index = appState.rules.findIndex(function(item){ return item.id === ruleId; });
  appState.rules.splice(index + 1, 0, clone);

  refreshRules();

  toast('Правило дублировано', 'success');
}

function confirmDeleteRule(ruleId){
  var rule = findRuleById(ruleId);
  if(!rule) return;

  openConfirm('Удалить правило?', 'Правило «' + (rule.title || 'без названия') + '» будет удалено.', function(){
    appState.rules = appState.rules.filter(function(item){ return item.id !== ruleId; });
    refreshRules();

    toast('Правило удалено', 'warning');
  });
}

function setLogic(nodeId, logic){
  var ctx = findNodeContext(nodeId);
  if(!ctx || ctx.node.type !== 'group') return;
  ctx.node.logic = logic;
  refreshRules();
  updateRuleSummary(ctx.rule.id);
}

function addLeaf(nodeId){
  var ctx = findNodeContext(nodeId);
  if(!ctx || ctx.node.type !== 'group') return;

  var leaf = createLeaf(nextUnusedFieldId(ctx.rule));
  ctx.node.children.push(leaf);
  refreshRules();
  toast('Поле добавлено в условие', 'success');
}

function addGroup(nodeId){
  var ctx = findNodeContext(nodeId);
  if(!ctx || ctx.node.type !== 'group') return;

  var childGroup = createGroup('and', [createLeaf(nextUnusedFieldId(ctx.rule))]);
  ctx.node.children.push(childGroup);
  refreshRules();
  toast('Вложенная группа добавлена', 'success');
}

function duplicateNode(nodeId){
  var ctx = findNodeContext(nodeId);
  if(!ctx || !ctx.parent) return;

  var clone = cloneNode(ctx.node);
  ctx.parent.children.splice(ctx.index + 1, 0, clone);
  refreshRules();
  toast('Элемент условия дублирован', 'success');
}

function confirmDeleteNode(nodeId){
  var ctx = findNodeContext(nodeId);
  if(!ctx) return;

  if(!ctx.parent){
    toast('Корневую группу нельзя удалить', 'warning');
    return;
  }

  var isGroup = ctx.node.type === 'group';
  var leaves = collectLeaves(ctx.node);
  var text = isGroup
    ? 'Группа будет удалена вместе с условиями. Количество полей: ' + leaves.length + '.'
    : 'Условие по полю «' + getFieldName(ctx.node.fieldId) + '» будет удалено.';

  openConfirm('Удалить элемент условия?', text, function(){
    ctx.parent.children.splice(ctx.index, 1);
    refreshRules();
    updateRuleSummary(ctx.rule.id);

    toast('Элемент удалён', 'warning');
  });
}

function moveNode(nodeId, dir){
  var ctx = findNodeContext(nodeId);
  if(!ctx || !ctx.parent) return;

  var delta = dir === 'up' ? -1 : 1;
  var newIndex = ctx.index + delta;
  if(newIndex < 0 || newIndex >= ctx.parent.children.length) return;

  var item = ctx.parent.children.splice(ctx.index, 1)[0];
  ctx.parent.children.splice(newIndex, 0, item);
  refreshRules();
}

function setLeafProp(nodeId, prop, value){
  var ctx = findNodeContext(nodeId);
  if(!ctx || ctx.node.type !== 'leaf') return;

  var leaf = ctx.node;

  if(prop === 'fieldId'){
    leaf.fieldId = value;
  }

  if(prop === 'trigger'){
    leaf.trigger = value;
    if(value === 'change'){
      if(!OPERATORS.change.some(function(op){ return op.value === leaf.operator; })) leaf.operator = 'changed';
    } else {
      if(!OPERATORS.fill.some(function(op){ return op.value === leaf.operator; })) leaf.operator = 'not_filled';
    }
  }

  if(prop === 'operator'){
    leaf.operator = value;
  }

  normalizeLeaf(leaf);
  refreshRules();
  updateRuleSummary(ctx.rule.id);
}

function saveSettings(){
  var validation = validateAll();

  if(validation.errors.length){

    openValidationModal('Сохранение отменено', validation.errors, validation.warnings);
    return;
  }

  var payload = serialize();

  /* Отправка на сервер через скрытую форму (надёжно в админке):
     POST на текущую страницу, sessid + JSON в полях. */
  var form = document.createElement('form');
  form.method = 'POST';
  form.style.display = 'none';

  var sessidField = document.createElement('input');
  sessidField.type = 'hidden';
  sessidField.name = 'sessid';
  sessidField.value = BX.message('bitrix_sessid');

  var jsonField = document.createElement('input');
  jsonField.type = 'hidden';
  jsonField.name = 'config_json';
  jsonField.value = JSON.stringify(payload);

  form.appendChild(sessidField);
  form.appendChild(jsonField);
  document.body.appendChild(form);
  form.submit();
}

function fallbackCopy(text){
  var textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  try{
    document.execCommand('copy');
    toast('JSON скопирован', 'success');
  } catch(err){
    toast('Не удалось скопировать JSON', 'danger');
  }
  document.body.removeChild(textarea);
}

function copyJson(){
  var text = JSON.stringify(serialize(), null, 2);
  if(navigator.clipboard && navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(function(){
      toast('JSON скопирован', 'success');
    }).catch(function(){
      fallbackCopy(text);
    });
  } else {
    fallbackCopy(text);
  }
}

function downloadJson(){
  var text = JSON.stringify(serialize(), null, 2);
  var blob = new Blob([text], {type:'application/json'});
  var url = URL.createObjectURL(blob);
  var link = document.createElement('a');
  link.href = url;
  link.download = 'bitrix24-field-control.json';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
  toast('JSON-конфигурация скачана', 'success');
}

function handleClick(event){
  var comboHit = event.target.closest('.fa-combo, .fa-combo-dropdown');
  if(!comboHit) closeAllFieldDropdowns();

  var el = event.target.closest('[data-action]');
  if(!el) return;

  var action = el.dataset.action;
  if(el.disabled) return;

  if(action === 'close-modal'){
    if(el.classList.contains('modal-backdrop') && event.target !== el) return;
    closeModal();
    return;
  }

  switch(action){
    case 'switch-tab':
      switchTab(el.dataset.tab);
      break;
    case 'add-rule':
      addRule();
      break;
    case 'save-settings':
      saveSettings();
      break;
    case 'field-search':
      openFieldDropdown(el.dataset.nodeId);
      break;
    case 'field-pick':
      pickField(el.dataset.nodeId, el.dataset.value);
      break;
    case 'toggle-rule-body':
      toggleRuleBody(el.dataset.ruleId);
      break;
    case 'delete-rule':
      confirmDeleteRule(el.dataset.ruleId);
      break;
    case 'duplicate-rule':
      duplicateRule(el.dataset.ruleId);
      break;
    case 'set-logic':
      setLogic(el.dataset.nodeId, el.dataset.logic);
      break;
    case 'add-leaf':
      addLeaf(el.dataset.nodeId);
      break;
    case 'add-group':
      addGroup(el.dataset.nodeId);
      break;
    case 'delete-node':
      confirmDeleteNode(el.dataset.nodeId);
      break;
    case 'duplicate-node':
      duplicateNode(el.dataset.nodeId);
      break;
    case 'move-node':
      moveNode(el.dataset.nodeId, el.dataset.dir);
      break;
    case 'copy-json':
      copyJson();
      break;
    case 'download-json':
      downloadJson();
      break;
    case 'confirm-yes':
      var callback = appState.confirmCallback;
      closeModal();
      if(callback) callback();
      break;
    default:
      break;
  }
}

function handleChange(event){
  var el = event.target;
  var action = el.dataset.action;
  if(!action) return;

  if(action === 'toggle-rule'){
    toggleRule(el.dataset.ruleId, el.checked);
    return;
  }

  if(action === 'set-rule-action'){
    var actionRule = findRuleById(el.dataset.ruleId);
    if(actionRule){ actionRule.action.type = el.value; refreshRules(); }
    return;
  }
  if(action === 'set-rule-fill-source'){
    var sourceRule = findRuleById(el.dataset.ruleId);
    if(!sourceRule) return;
    sourceRule.fillFieldsSource = el.value;
    if(el.value === 'conditions') sourceRule.action.fillFieldIds = [];
    else if(!(sourceRule.action.fillFieldIds || []).length){
      sourceRule.action.fillFieldIds = fillFieldsForRule(sourceRule).filter(function(field){ return field.editable !== false; }).map(function(field){ return field.id; });
    }
    refreshRules();
    return;
  }
  if(action === 'set-rule-fill-fields'){
    var fillRule = findRuleById(el.dataset.ruleId);
    if(!fillRule) return;
    var ids = fillRule.action.fillFieldIds || [];
    fillRule.fillFieldsSource = 'manual';
    // Меняем только один ID: скрытые поиском выбранные поля остаются в модели.
    fillRule.action.fillFieldIds = el.checked
      ? (ids.indexOf(el.value) < 0 ? ids.concat(el.value) : ids)
      : ids.filter(function(id){ return id !== el.value; });
    el.closest('.fa-fill-fields').querySelector('.fa-fill-fields-count').textContent = 'Выбрано: ' + fillRule.action.fillFieldIds.length;
    updateRuleSummary(fillRule.id);
    return;
  }
  if(action === 'set-rule-stage'){
    var stageRule = findRuleById(el.dataset.ruleId);
    if(!stageRule) return;
    var stageIds = ruleStageIds(stageRule);
    stageRule.stageIds = el.checked
      ? (stageIds.indexOf(el.value) < 0 ? stageIds.concat(el.value) : stageIds)
      : stageIds.filter(function(id){ return id !== el.value; });
    el.closest('.fa-stage-picker').querySelector('.fa-fill-fields-count').textContent = stageSelectionText(stageRule);
    updateRuleSummary(stageRule.id);
    return;
  }
  if(action === 'set-rule-stage-mode' || action === 'set-rule-fill-mode'){
    var editedRule = findRuleById(el.dataset.ruleId);
    if(!editedRule) return;
    if(action === 'set-rule-stage-mode') editedRule.stageMode = el.value;
    if(action === 'set-rule-fill-mode') editedRule.action.fillMode = el.value;
    refreshRules();
    return;
  }

  if(el.tagName === 'SELECT'){
    switch(action){
      case 'set-trigger':
        setLeafProp(el.dataset.nodeId, 'trigger', el.value);
        break;
      case 'set-operator':
        setLeafProp(el.dataset.nodeId, 'operator', el.value);
        break;
      case 'set-rule-action':{
        var rule = findRuleById(el.dataset.ruleId);
        if(rule){
          rule.action = rule.action || {};
          rule.action.type = el.value;
          refreshRules();
          updateRuleSummary(rule.id);
        }
        break;
      }
      case 'set-rule-bp':{
        var rule = findRuleById(el.dataset.ruleId);
        if(rule){
          rule.action = rule.action || {};
          rule.action.bpId = el.value;
          refreshRules();
          updateRuleSummary(rule.id);
        }
        break;
      }
      case 'set-rule-fill-title':{
        var rule = findRuleById(el.dataset.ruleId);
        if(rule){
          rule.action = rule.action || {};
          rule.action.fillWindowTitle = el.value;
          updateRuleSummary(rule.id);
        }
        break;
      }
      default:
        break;
    }
    return;
  }

}

function handleInput(event){
  var el = event.target;
  var action = el.dataset.action;
  if(!action) return;

  if(action === 'search-rule-fill-fields' || action === 'search-rule-stages'){
    filterFillFieldPicker(el);
    return;
  }

  if(action === 'set-rule-fill-title'){
    var titleRule = findRuleById(el.dataset.ruleId);
    if(titleRule){ titleRule.action.fillWindowTitle = el.value; updateRuleSummary(titleRule.id); }
    return;
  }

  if(action === 'field-search'){
    filterFieldDropdown(el.dataset.nodeId, el.value);
    return;
  }

  if(action === 'set-rule-title'){
    var rule = findRuleById(el.dataset.ruleId);
    if(rule){
      rule.title = el.value;
      updateRuleSummary(rule.id);
    }
    return;
  }

}

function handleKeydown(event){
  if(event.key === 'Escape'){
    if(document.querySelector('.fa-combo-dropdown.open')){
      closeAllFieldDropdowns();
      return;
    }
    if(document.getElementById('modalRoot').innerHTML){
      closeModal();
    }
    return;
  }

  if(event.key === 'Enter'){
    var open = document.querySelector('.fa-combo-dropdown.open');
    if(open){
      var opt = open.querySelector('.fa-combo-option');
      if(opt){
        event.preventDefault();
        pickField(opt.dataset.nodeId, opt.dataset.value);
      }
    }
  }
}

function bindEvents(){
  window.addEventListener('resize', closeAllFieldDropdowns);
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', closeAllFieldDropdowns);
    window.visualViewport.addEventListener('scroll', closeAllFieldDropdowns);
  }
  document.addEventListener('click', handleClick);
  document.addEventListener('change', handleChange);
  document.addEventListener('input', handleInput);
  document.addEventListener('keydown', handleKeydown);

  /* Закрываем выпадающие списки поиска поля при прокрутке страницы */
  document.addEventListener('scroll', function(event){
    var t = event.target;
    if(t && t.classList && t.classList.contains('fa-combo-dropdown')) return;
    closeAllFieldDropdowns();
  }, true);
}

function init(){

  appState.rules = loadRules();
  bindEvents();
  switchTab('rules');
}

BX.ready(init);

})();
