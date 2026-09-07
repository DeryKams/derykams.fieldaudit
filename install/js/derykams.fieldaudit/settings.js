
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
  fieldStates:{},
  log:[],
  tests:[],
  confirmCallback:null,
  fillModal:null,
  simStage:''
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

function sampleValue(field){
  return field && field.type === 'file' ? 'document.pdf' : 'Заполненное значение';
}

function sampleChangedValue(field){
  return field && field.type === 'file' ? 'document_v2.pdf' : 'Новое значение';
}

function ensureFieldState(fieldId){
  if(!appState.fieldStates[fieldId]){
    appState.fieldStates[fieldId] = {prev:'', curr:''};
  }
  return appState.fieldStates[fieldId];
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
    stageId: '',
    action: {
      type: 'fill',
      bpId: BP_CATALOG[0] ? BP_CATALOG[0].id : '',
      fillWindowTitle: 'Заполните обязательные поля'
    }
  };
}

function createDemoRules(){
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
        stageId: rule.stageId || '',
        action: {
          type: action.type === 'bp' ? 'bp' : 'fill',
          bpId: action.bpId || (BP_CATALOG[0] ? BP_CATALOG[0].id : ''),
          fillWindowTitle: action.fillWindowTitle || 'Заполните обязательные поля'
        }
      };
    });
  }

  /* Нет сохранённых — демо-правила из реальных полей портала,
     чтобы первое открытие выглядело как в примере UI.
     Не попадают в БД, пока не нажата кнопка "Сохранить". */
  var fileFields = FIELD_CATALOG.filter(function(f){ return f.type === 'file'; });
  var other = FIELD_CATALOG.filter(function(f){ return f.type !== 'file'; });
  var seed = fileFields.concat(other);

  if(seed.length >= 5){
    var demoRules = [
      createRule('Обязательные документы', 'and', [
        createLeaf(seed[0].id, {trigger:'fill', operator:'not_filled'}),
        createLeaf(seed[1].id, {trigger:'fill', operator:'not_filled'})
      ])
    ];

    /* Второе демо-правило использует запуск БП — добавляем только если
       на портале есть шаблоны БП для сделок, иначе лист останется пустым. */
    if(BP_CATALOG.length){
      demoRules.push(
        createRule('Сложная проверка', 'or', [
          createGroup('and', [
            createLeaf(seed[2].id, {trigger:'change', operator:'changed'}),
            createLeaf(seed[3].id, {trigger:'fill', operator:'filled'})
          ]),
          createLeaf(seed[4].id, {trigger:'change', operator:'changed_to_filled'})
        ])
      );
    }

    return demoRules;
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
    root: cloneNode(rule.root)
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
  if(!getField(leaf.fieldId)) leaf.fieldId = FIELD_CATALOG[0] ? FIELD_CATALOG[0].id : '';
  if(leaf.trigger !== 'change' && leaf.trigger !== 'fill') leaf.trigger = 'fill';

  var allowed = OPERATORS[leaf.trigger].map(function(item){ return item.value; });
  if(allowed.indexOf(leaf.operator) === -1){
    leaf.operator = leaf.trigger === 'fill' ? 'not_filled' : 'changed';
  }
}

function checkLeaf(leaf, states){
  var st = states[leaf.fieldId] || {prev:'', curr:''};
  var prev = String(st.prev || '').trim();
  var curr = String(st.curr || '').trim();
  var changed = prev !== curr;
  var filled = curr !== '';
  var prevFilled = prev !== '';

  switch(leaf.operator){
    case 'changed': return changed;
    case 'changed_to_filled': return changed && filled;
    case 'changed_to_empty': return changed && !filled && prevFilled;
    case 'filled': return filled;
    case 'not_filled': return !filled;
    default: return false;
  }
}

/* Возвращает результат узла и листья, которые реально вошли в выполненную ветку. */
function evalNode(node, states){
  if(node.type === 'leaf'){
    var ok = checkLeaf(node, states);
    return {ok:ok, activeLeaves: ok ? [node] : []};
  }

  if(!node.children.length){
    return {ok:false, activeLeaves:[]};
  }

  var childResults = node.children.map(function(child){
    return evalNode(child, states);
  });

  var resultOk = node.logic === 'and'
    ? childResults.every(function(item){ return item.ok; })
    : childResults.some(function(item){ return item.ok; });

  var active = [];
  if(resultOk){
    childResults.forEach(function(item){
      if(item.ok) active = active.concat(item.activeLeaves);
    });
  }

  return {ok:resultOk, activeLeaves:active};
}

function collectActions(rule, activeLeaves){
  /* Действие одно на правило; поля окна заполнения — из активных листьев. */
  var action = rule.action || {};
  var fillFields = [];

  activeLeaves.forEach(function(leaf){
    var field = getField(leaf.fieldId);
    if(field && !fillFields.some(function(item){ return item.id === field.id; })){
      fillFields.push(field);
    }
  });

  return {
    type: action.type === 'bp' ? 'bp' : 'fill',
    bpId: action.bpId || '',
    fillFields: fillFields,
    fillTitle: action.fillWindowTitle || 'Заполните обязательные поля'
  };
}

function evaluateAllRules(){
  return appState.rules.map(function(rule){
    if(rule.stageId && rule.stageId !== appState.simStage){
      return {rule: rule, leaves: collectLeaves(rule.root),
        evalRes: {ok:false, activeLeaves:[]}, activeIds: {},
        actions: collectActions(rule, [])};
    }
    var leaves = collectLeaves(rule.root);
    var evalRes = rule.enabled
      ? evalNode(rule.root, appState.fieldStates)
      : {ok:false, activeLeaves:[]};
    var activeIds = {};
    evalRes.activeLeaves.forEach(function(leaf){ activeIds[leaf.id] = true; });
    return {
      rule: rule,
      leaves: leaves,
      evalRes: evalRes,
      activeIds: activeIds,
      actions: collectActions(rule, evalRes.activeLeaves)
    };
  });
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
  var leaves = collectLeaves(rule.root);
  var names = leaves.map(function(leaf){ return getFieldName(leaf.fieldId); });
  return '<span class="ui-badge ui-badge-danger">Окно заполнения: ' +
    escapeHtml(names.join(', ') || 'поля правила') + '</span>';
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
  if(action.type === 'fill'){
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
  if(!appState.rules.length) errors.push('Добавьте хотя бы одно правило.');

  appState.rules.forEach(function(rule, index){
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
    version:1,
    savedAt:new Date().toISOString(),
    rules: appState.rules.map(function(rule){
      return {
        id: rule.id,
        title: rule.title,
        enabled: rule.enabled,
        condition: serializeNode(rule.root),
        stageId: rule.stageId || '',
        action: {
          type: (rule.action && rule.action.type === 'bp') ? 'bp' : 'fill',
          bpId: (rule.action && rule.action.type === 'bp') ? (rule.action.bpId || null) : null,
          fillWindowTitle: (rule.action && rule.action.type !== 'bp') ? (rule.action.fillWindowTitle || null) : null
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
  var dd = combo.querySelector('.fa-combo-dropdown');
  if(dd.classList.contains('open')) return;

  var ctx = findNodeContext(nodeId);
  var selectedFieldId = (ctx && ctx.node.type === 'leaf') ? ctx.node.fieldId : '';

  dd.innerHTML = fieldOptionsHtml(nodeId, '', selectedFieldId);
  dd.classList.add('open');

  var r = combo.querySelector('.fa-combo-search').getBoundingClientRect();
  dd.style.position = 'fixed';
  dd.style.top = (r.bottom + 4) + 'px';
  dd.style.left = r.left + 'px';
  dd.style.width = r.width + 'px';
}

function filterFieldDropdown(nodeId, query){
  var combo = fieldComboEl(nodeId);
  if(!combo) return;
  var ctx = findNodeContext(nodeId);
  var selectedFieldId = (ctx && ctx.node.type === 'leaf') ? ctx.node.fieldId : '';
  var dd = combo.querySelector('.fa-combo-dropdown');
  dd.innerHTML = fieldOptionsHtml(nodeId, query, selectedFieldId);
  dd.classList.add('open');
}

function closeFieldDropdown(nodeId){
  var combo = fieldComboEl(nodeId);
  if(!combo) return;
  var dd = combo.querySelector('.fa-combo-dropdown');
  dd.classList.remove('open');
  dd.innerHTML = '';
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
    var dd = combo.querySelector('.fa-combo-dropdown');
    if(dd.classList.contains('open')){
      dd.classList.remove('open');
      dd.innerHTML = '';
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
      '<div class="group-title">' + (ctx.isRoot ? 'Условия правила' : 'Вложенная группа') + '</div>' +
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
      '<div class="summary-expression">' + escapeHtml(nodeText(rule.root, true)) + '</div>' +
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

function renderRuleActionBlock(rule){
  var action = rule.action || {};
  var isBp = action.type === 'bp';

  var stageSelect = '<select class="ui-select" data-action="set-rule-stage" data-rule-id="' + rule.id + '">' +
    '<option value="">На любую стадию</option>' +
    STAGE_CATALOG.map(function(st){
      return optionHtml(st.id, st.name + ' — ' + st.id, st.id === rule.stageId, false);
    }).join('') +
    '</select>';

  var bpSelect = '<select class="ui-select" data-action="set-rule-bp" data-rule-id="' + rule.id + '"' +
    (isBp ? '' : ' disabled') + '>' +
    BP_CATALOG.map(function(bp){
      return optionHtml(bp.id, bp.name, bp.id === action.bpId, false);
    }).join('') +
    '</select>';

  var titleInput = '<input class="ui-input" type="text" value="' + escapeHtml(action.fillWindowTitle || '') +
    '" placeholder="Заголовок окна заполнения" data-action="set-rule-fill-title" data-rule-id="' + rule.id + '"' +
    (isBp ? ' disabled' : '') + '>';

  return '<div class="rule-action-block">' +
    '<div class="rule-action-block-title">Действие правила</div>' +
    '<div class="rule-action-stage-row">' +
      '<label class="rule-action-stage-label">При переходе на стадию</label>' +
      stageSelect +
    '</div>' +
    '<div class="rule-action-row">' +
      '<label class="ui-radio"><input type="radio" name="rule-action-' + rule.id + '" value="fill"' +
        (isBp ? '' : ' checked') + ' data-action="set-rule-action" data-rule-id="' + rule.id + '"> Окно заполнения</label>' +
      '<label class="ui-radio"><input type="radio" name="rule-action-' + rule.id + '" value="bp"' +
        (isBp ? ' checked' : '') + ' data-action="set-rule-action" data-rule-id="' + rule.id + '"> Бизнес-процесс</label>' +
    '</div>' +
    '<div class="rule-action-params">' +
      '<div class="rule-action-param' + (isBp ? '' : ' hidden') + '">' + bpSelect + '</div>' +
      '<div class="rule-action-param' + (isBp ? ' hidden' : '') + '">' + titleInput +
        '<div class="cell-hint">Окно откроется с полями, попавшими в истинную ветку условия.</div></div>' +
    '</div>' +
    '<div class="rule-action-preview">' +
      '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="preview-rule-fill" data-rule-id="' + rule.id + '"' +
        (isBp ? ' disabled' : '') + '>Пример окна</button>' +
    '</div>' +
    '</div>';
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
    html += '<div class="ui-alert ui-alert-warning">Правил пока нет. Добавьте первое правило.</div>';
  } else {
    html += appState.rules.map(renderRuleCard).join('');
  }

  document.getElementById('tab-rules').innerHTML = html;
}

function refreshRules(){
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

function getSimulationFields(){
  var map = {};
  var result = [];
  appState.rules.forEach(function(rule){
    if(!rule.enabled) return;
    collectLeaves(rule.root).forEach(function(leaf){
      var field = getField(leaf.fieldId);
      if(field && !map[field.id]){
        map[field.id] = true;
        result.push(field);
      }
    });
  });
  return result;
}

function fieldStatusHtml(fieldId){
  var st = ensureFieldState(fieldId);
  var prev = String(st.prev || '').trim();
  var curr = String(st.curr || '').trim();
  var changed = prev !== curr;
  var filled = curr !== '';

  return '<span class="ui-badge ' + (filled ? 'ui-badge-info' : 'ui-badge-muted') + '">' +
      (filled ? 'Заполнено' : 'Пусто') +
    '</span>' +
    '<span class="ui-badge ' + (changed ? 'ui-badge-success' : 'ui-badge-muted') + '">' +
      (changed ? 'Изменено' : 'Без изменений') +
    '</span>';
}

function renderSimFieldRow(field){
  var st = ensureFieldState(field.id);
  var typeLabel = field.type === 'file' ? 'Файл' : 'Строка';
  var typeClass = field.type === 'file' ? 'ui-badge-warning' : 'ui-badge-info';
  var placeholder = field.type === 'file' ? 'имя файла' : 'значение';

  return '<div class="sim-field-row" id="sim-row-' + field.id + '">' +
    '<div class="sim-field">' +
      '<div class="sim-field-name">' + escapeHtml(field.name) + '</div>' +
      '<div class="field-meta">' +
        '<span class="ui-badge ' + typeClass + '">' + typeLabel + '</span>' +
        '<span class="field-id">' + escapeHtml(field.id) + '</span>' +
      '</div>' +
    '</div>' +
    '<div class="sim-input">' +
      '<label class="sim-label">Было</label>' +
      '<input class="ui-input" type="text" value="' + escapeHtml(st.prev) + '" placeholder="пусто" data-action="sim-value" data-field-id="' + field.id + '" data-field="prev">' +
    '</div>' +
    '<div class="sim-input">' +
      '<label class="sim-label">Стало</label>' +
      '<input class="ui-input" type="text" value="' + escapeHtml(st.curr) + '" placeholder="' + placeholder + '" data-action="sim-value" data-field-id="' + field.id + '" data-field="curr">' +
    '</div>' +
    '<div class="sim-status" id="sim-status-' + field.id + '">' + fieldStatusHtml(field.id) + '</div>' +
    '<div class="sim-quick">' +
      '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="sim-quick" data-field-id="' + field.id + '" data-mode="clear">Очистить</button>' +
      '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="sim-quick" data-field-id="' + field.id + '" data-mode="fill">Заполнить</button>' +
      '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="sim-quick" data-field-id="' + field.id + '" data-mode="change">Изменить</button>' +
    '</div>' +
    '</div>';
}

function renderSimulationResultsHtml(){
  var results = evaluateAllRules();
  if(!results.length) return '<div class="empty">Нет правил для проверки.</div>';

  return results.map(function(res){
    var rule = res.rule;
    var statusClass = '';
    var statusBadge = '<span class="ui-badge ui-badge-muted">Не выполнено</span>';

    if(!rule.enabled){
      statusClass = 'off';
      statusBadge = '<span class="ui-badge ui-badge-warning">Правило отключено</span>';
    } else if(res.evalRes.ok){
      statusClass = 'ok';
      statusBadge = '<span class="ui-badge ui-badge-success">Условие выполнено</span>';
    }

    var chips = res.leaves.map(function(leaf){
      var leafOk = checkLeaf(leaf, appState.fieldStates);
      var isActive = Boolean(res.activeIds[leaf.id]);
      var chipClass = 'chip-muted';
      var chipTitle = 'Условие ложно';

      if(!rule.enabled){
        chipClass = 'chip-muted';
        chipTitle = 'Правило отключено';
      } else if(isActive){
        chipClass = 'chip-success';
        chipTitle = 'Условие истинно и входит в выполненную ветку';
      } else if(leafOk){
        chipClass = 'chip-warning';
        chipTitle = 'Условие истинно, но родительская группа не выполнена';
      }

      return '<span class="chip ' + chipClass + '" title="' + escapeHtml(chipTitle) + '">' +
        escapeHtml(getFieldName(leaf.fieldId)) + ' · ' + escapeHtml(operatorShort(leaf.operator)) +
        '</span>';
    }).join('');

    var actionsHtml = '';
    if(!rule.enabled){
      actionsHtml = '<div class="muted-text">Действия не выполняются, пока правило отключено.</div>';
    } else if(!res.evalRes.ok){
      actionsHtml = '<div class="muted-text">Действия не выполняются.</div>';
    } else {
      var parts = [];
      if(res.actions.bps.length){
        parts.push(res.actions.bps.map(function(bp){
          return '<span class="ui-badge ui-badge-info">БП: ' + escapeHtml(bp.name) + '</span>';
        }).join(''));
      }
      if(res.actions.fillFields.length){
        parts.push('<span class="ui-badge ui-badge-danger">Окно заполнения: ' +
          escapeHtml(res.actions.fillFields.map(function(field){ return field.name; }).join(', ')) +
          '</span>');
      }
      if(!parts.length){
        parts.push('<span class="ui-badge ui-badge-warning">Условие выполнено, но действия не заданы</span>');
      }
      actionsHtml = '<div class="summary-actions">' + parts.join('') + '</div>' +
        '<div class="result-run"><button class="ui-btn ui-btn-primary ui-btn-sm" data-action="run-check" data-rule-id="' + rule.id + '">Выполнить действия правила</button></div>';
    }

    return '<div class="result-card ' + statusClass + '">' +
      '<div class="result-head">' +
        '<div class="result-title">' + escapeHtml(rule.title || 'Без названия') + '</div>' +
        statusBadge +
      '</div>' +
      '<div class="result-expression">' + escapeHtml(nodeText(rule.root, true)) + '</div>' +
      '<div class="chip-list">' + (chips || '<span class="chip chip-muted">Нет условий</span>') + '</div>' +
      actionsHtml +
      '</div>';
  }).join('');
}

function renderSimulationResults(){
  var el = document.getElementById('simResults');
  if(el) el.innerHTML = renderSimulationResultsHtml();
}

function updateFieldStatus(fieldId){
  var el = document.getElementById('sim-status-' + fieldId);
  if(el) el.innerHTML = fieldStatusHtml(fieldId);
}

function renderLogItems(){
  if(!appState.log.length){
    return '<div class="empty">Событий пока нет.</div>';
  }
  return appState.log.map(function(item){
    return '<div class="log-item log-' + item.type + '">' +
      '<span class="log-time">' + item.time.toLocaleTimeString('ru-RU') + '</span>' +
      '<span><strong>' + escapeHtml(item.message) + '</strong>' +
      (item.details ? '<span class="log-details">' + escapeHtml(item.details) + '</span>' : '') +
      '</span>' +
      '</div>';
  }).join('');
}

function renderLog(){
  var el = document.getElementById('logList');
  if(el) el.innerHTML = renderLogItems();
}

function addLog(type, message, details){
  appState.log.unshift({
    id: uid('log'),
    time: new Date(),
    type: type,
    message: message,
    details: details || ''
  });
  if(appState.log.length > 80) appState.log.pop();
  renderLog();
}

function renderTestsResultsHtml(){
  if(!appState.tests.length){
    return '<div class="empty">Тесты ещё не запускались. Нажмите «Прогнать тесты логики».</div>';
  }

  var allPass = appState.tests.every(function(test){ return test.pass; });
  var rows = appState.tests.map(function(test){
    return '<tr>' +
      '<td>' + escapeHtml(test.name) + '</td>' +
      '<td>' + (test.expect ? 'true' : 'false') + '</td>' +
      '<td>' + (test.actual ? 'true' : 'false') + '</td>' +
      '<td>' + test.expectActive + ' / ' + test.active + '</td>' +
      '<td><span class="ui-badge ' + (test.pass ? 'ui-badge-success' : 'ui-badge-danger') + '">' +
        (test.pass ? 'OK' : 'FAIL') +
      '</span></td>' +
      '</tr>';
  }).join('');

  return '<div class="ui-alert ' + (allPass ? 'ui-alert-success' : 'ui-alert-danger') + '">' +
      (allPass ? 'Все сценарии логики пройдены.' : 'Есть сценарии, которые требуют проверки.') +
    '</div>' +
    '<div class="table-scroll"><table class="ui-table">' +
      '<thead><tr><th>Сценарий</th><th>Ожидалось</th><th>Получено</th><th>Ожидалось активных / получено</th><th>Статус</th></tr></thead>' +
      '<tbody>' + rows + '</tbody>' +
    '</table></div>';
}

function renderTests(){
  var el = document.getElementById('testsResults');
  if(el) el.innerHTML = renderTestsResultsHtml();
}

function runLogicTests(){
  var A = 'UF_CRM_1768379973';
  var B = 'UF_CRM_1768379974';
  var C = 'UF_CRM_1768379975';
  var D = 'UF_CRM_1768379976';

  function tLeaf(fieldId, trigger, operator){
    return {
      id: uid('test_leaf'),
      type:'leaf',
      fieldId: fieldId,
      trigger: trigger,
      operator: operator
    };
  }

  function tGroup(logic, children){
    return {
      id: uid('test_group'),
      type:'group',
      logic: logic,
      children: children
    };
  }

  var cases = [
    {
      name:'И: оба файла не заполнены — окно заполнения срабатывает',
      node:tGroup('and',[tLeaf(A,'fill','not_filled'), tLeaf(B,'fill','not_filled')]),
      states:{},
      expect:true,
      expectActive:2
    },
    {
      name:'И: один из двух файлов заполнен — проверка не срабатывает',
      node:tGroup('and',[tLeaf(A,'fill','not_filled'), tLeaf(B,'fill','not_filled')]),
      states:{},
      expect:false,
      expectActive:0
    },
    {
      name:'И: оба файла заполнены — проверка не срабатывает',
      node:tGroup('and',[tLeaf(A,'fill','not_filled'), tLeaf(B,'fill','not_filled')]),
      states:{},
      expect:false,
      expectActive:0
    },
    {
      name:'ИЛИ: один из двух файлов не заполнен — срабатывает только пустое поле',
      node:tGroup('or',[tLeaf(A,'fill','not_filled'), tLeaf(B,'fill','not_filled')]),
      states:{},
      expect:true,
      expectActive:1
    },
    {
      name:'ИЛИ: оба файла заполнены — проверка не срабатывает',
      node:tGroup('or',[tLeaf(A,'fill','not_filled'), tLeaf(B,'fill','not_filled')]),
      states:{},
      expect:false,
      expectActive:0
    },
    {
      name:'И: строка изменилась и счёт заполнен — условие true',
      node:tGroup('and',[tLeaf(D,'change','changed'), tLeaf(C,'fill','filled')]),
      states:{},
      expect:true,
      expectActive:2
    },
    {
      name:'И: строка изменилась, но счёт пустой — условие false',
      node:tGroup('and',[tLeaf(D,'change','changed'), tLeaf(C,'fill','filled')]),
      states:{},
      expect:false,
      expectActive:0
    },
    {
      name:'Вложенное: (изменение И файл пустой) ИЛИ комментарий заполнен — первая ветка true',
      node:tGroup('or',[
        tGroup('and',[tLeaf(D,'change','changed'), tLeaf(A,'fill','not_filled')]),
        tLeaf(C,'fill','filled')
      ]),
      states:{},
      expect:true,
      expectActive:2
    },
    {
      name:'Вложенное: первая ветка false, вторая true — активна только вторая ветка',
      node:tGroup('or',[
        tGroup('and',[tLeaf(D,'change','changed'), tLeaf(A,'fill','not_filled')]),
        tLeaf(C,'fill','filled')
      ]),
      states:{},
      expect:true,
      expectActive:1
    },
    {
      name:'Вложенное: все ветки false — действия не срабатывают',
      node:tGroup('or',[
        tGroup('and',[tLeaf(D,'change','changed'), tLeaf(A,'fill','not_filled')]),
        tLeaf(C,'fill','filled')
      ]),
      states:{},
      expect:false,
      expectActive:0
    }
  ];

  cases[1].states[A] = {prev:'', curr:'scan.pdf'};
  cases[2].states[A] = {prev:'', curr:'scan.pdf'};
  cases[2].states[B] = {prev:'', curr:'agreement.pdf'};
  cases[3].states[A] = {prev:'', curr:'scan.pdf'};
  cases[4].states[A] = {prev:'', curr:'scan.pdf'};
  cases[4].states[B] = {prev:'', curr:'agreement.pdf'};
  cases[5].states[D] = {prev:'старый комментарий', curr:'новый комментарий'};
  cases[5].states[C] = {prev:'', curr:'12345'};
  cases[6].states[D] = {prev:'старый комментарий', curr:'новый комментарий'};
  cases[6].states[C] = {prev:'', curr:''};
  cases[7].states[D] = {prev:'старый комментарий', curr:'новый комментарий'};
  cases[7].states[A] = {prev:'', curr:''};
  cases[7].states[C] = {prev:'', curr:''};
  cases[8].states[D] = {prev:'старый комментарий', curr:'старый комментарий'};
  cases[8].states[A] = {prev:'', curr:'scan.pdf'};
  cases[8].states[C] = {prev:'', curr:'12345'};
  cases[9].states[D] = {prev:'старый комментарий', curr:'старый комментарий'};
  cases[9].states[A] = {prev:'', curr:'scan.pdf'};
  cases[9].states[C] = {prev:'', curr:''};

  appState.tests = cases.map(function(testCase){
    var res = evalNode(testCase.node, testCase.states);
    var pass = res.ok === testCase.expect && res.activeLeaves.length === testCase.expectActive;
    return {
      name: testCase.name,
      expect: testCase.expect,
      actual: res.ok,
      expectActive: testCase.expectActive,
      active: res.activeLeaves.length,
      pass: pass
    };
  });

  renderTests();

  var allPass = appState.tests.every(function(test){ return test.pass; });
  toast(allPass ? 'Все тесты логики пройдены' : 'Часть тестов не прошла', allPass ? 'success' : 'danger');
  addLog(allPass ? 'success' : 'error', 'Выполнена юнит-проверка логики условий');
}

function renderSimulatorTab(){
  var fields = getSimulationFields();
  var fieldsHtml = fields.length
    ? fields.map(renderSimFieldRow).join('')
    : '<div class="ui-alert ui-alert-warning">Нет включённых правил с полями. Включите правило или добавьте поля.</div>';

  var html = '<div class="tab-inner">' +
    '<div class="section-card">' +
      '<div class="section-head">' +
        '<div>' +
          '<h2 class="section-title">Симуляция значений полей</h2>' +
          '<p class="section-subtitle">Задайте старое и новое значение, затем выполните проверку. Отобразятся только те действия, которые реально должны сработать.</p>' +
        '</div>' +
        '<div class="toolbar-actions">' +
          '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="sim-scenario" data-mode="clear">Все пустые</button>' +
          '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="sim-scenario" data-mode="fill">Все заполнены</button>' +
          '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="sim-scenario" data-mode="change">Все изменены</button>' +
          '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="sim-scenario" data-mode="random">Случайный сценарий</button>' +
          '<button class="ui-btn ui-btn-primary" data-action="run-check">Запустить проверку</button>' +
        '</div>' +
      '</div>' +
      fieldsHtml +
    '</div>' +

    '<div class="sim-grid">' +
      '<div>' +
        '<div class="section-card">' +
          '<div class="section-head">' +
            '<div><h3 class="section-title">Результат вычисления</h3></div>' +
          '</div>' +
          '<div id="simResults">' + renderSimulationResultsHtml() + '</div>' +
        '</div>' +

        '<div class="section-card">' +
          '<div class="section-head">' +
            '<div><h3 class="section-title">Юнит-проверка логики</h3></div>' +
            '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="run-tests">Прогнать тесты логики</button>' +
          '</div>' +
          '<div id="testsResults">' + renderTestsResultsHtml() + '</div>' +
        '</div>' +
      '</div>' +

      '<div class="section-card">' +
        '<div class="section-head">' +
          '<div><h3 class="section-title">Журнал событий</h3></div>' +
          '<button class="ui-btn ui-btn-light ui-btn-sm" data-action="clear-log">Очистить</button>' +
        '</div>' +
        '<div id="logList" class="log-list">' + renderLogItems() + '</div>' +
      '</div>' +
    '</div>' +
    '</div>';

  document.getElementById('tab-simulator').innerHTML = html;
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
          '<p>Под каждым правилом выводится текстовая формула и список действий. На вкладке «Симуляция» видно, какие листья условия истинны, какие из них вошли в выполненную ветку и какие действия будут запущены.</p>' +
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
  if(tab === 'simulator'){
    renderSimulatorTab();
  }
  if(tab === 'json'){
    document.getElementById('tab-json').innerHTML = renderJsonTab();
  }
}

function switchTab(tab){
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
  appState.fillModal = null;
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

function openFillModal(fields, title, options){
  if(!fields.length) return;
  options = options || {};

  appState.fillModal = {
    fields: fields,
    preview: Boolean(options.preview),
    groups: options.groups || []
  };

  var fieldsHtml = fields.map(function(field){
    var st = ensureFieldState(field.id);
    var currentHint = st.curr ? ('Текущее значение: ' + escapeHtml(st.curr)) : 'Текущее значение: пусто';
    var control;

    if(field.type === 'file'){
      control = '<input class="ui-input ui-input-file" type="file" data-action="fill-value" data-field-id="' + field.id + '" data-fill-control="1">';
    } else {
      control = '<input class="ui-input" type="text" value="' + escapeHtml(st.curr || '') + '" placeholder="Введите значение" data-action="fill-value" data-field-id="' + field.id + '" data-fill-control="1">';
    }

    return '<div class="fill-field" data-field-block="' + field.id + '">' +
      '<label class="ui-form-label">' + escapeHtml(field.name) + ' <span class="required">*</span></label>' +
      '<div class="field-meta">' +
        '<span class="field-id">' + escapeHtml(field.id) + '</span>' +
        '<span class="ui-badge ' + (field.type === 'file' ? 'ui-badge-warning' : 'ui-badge-info') + '">' + (field.type === 'file' ? 'Файл' : 'Строка') + '</span>' +
        '<span class="muted-text">' + currentHint + '</span>' +
      '</div>' +
      control +
      '<div class="field-error">Поле обязательно для заполнения</div>' +
      '</div>';
  }).join('');

  var content = '<div class="ui-alert ui-alert-info">' +
      'Это обязательное окно заполнения. В реальной логике модуля оно открывается только тогда, когда условие по группе полей выполнено.' +
    '</div>' + fieldsHtml;

  openModal({
    title: title || 'Заполните обязательные поля',
    content: content,
    size: '',
    footer:
      '<button class="ui-btn ui-btn-light" data-action="close-modal">Отмена</button>' +
      '<button class="ui-btn ui-btn-primary" data-action="submit-fill">' +
        (options.preview ? 'Проверить и закрыть' : 'Заполнить и сохранить') +
      '</button>',
    onMount: function(){
      var first = document.querySelector('#modalRoot [data-fill-control]');
      if(first) first.focus();
    }
  });
}

function clearFillError(el){
  var block = el.closest('[data-field-block]');
  if(block) block.classList.remove('has-error');
}

function submitFillModal(){
  if(!appState.fillModal) return;

  var fields = appState.fillModal.fields;
  var preview = appState.fillModal.preview;
  var hasError = false;

  fields.forEach(function(field){
    var block = document.querySelector('#modalRoot [data-field-block="' + field.id + '"]');
    if(!block) return;
    var input = block.querySelector('[data-fill-control]');
    if(!input) return;

    var value = '';
    if(field.type === 'file'){
      value = input.files && input.files[0] ? input.files[0].name : '';
    } else {
      value = String(input.value || '').trim();
    }

    if(!value){
      hasError = true;
      block.classList.add('has-error');
    } else {
      block.classList.remove('has-error');
      if(!preview) ensureFieldState(field.id).curr = value;
    }
  });

  if(hasError){
    toast('Заполните все обязательные поля', 'danger');
    return;
  }

  var names = fields.map(function(field){ return field.name; }).join(', ');
  closeModal();

  if(preview){
    toast('Пример окна заполнения проверен', 'success');
    addLog('info', 'Пример окна заполнения проверен', names);
  } else {
    toast('Поля заполнены', 'success');
    addLog('success', 'Окно заполнения закрыто. Поля заполнены', names);
    if(appState.activeTab === 'simulator') renderSimulatorTab();
  }
}

function previewRuleFill(ruleId){
  var rule = findRuleById(ruleId);
  if(!rule) return;
  var action = rule.action || {};
  if(action.type !== 'fill'){
    toast('Действие «Окно заполнения» не выбрано для этого правила', 'warning');
    return;
  }

  var fields = collectLeaves(rule.root).map(function(leaf){ return getField(leaf.fieldId); }).filter(Boolean);
  if(!fields.length){
    toast('В правиле нет полей для окна заполнения', 'warning');
    return;
  }

  openFillModal(fields, action.fillWindowTitle || 'Заполните обязательные поля', {preview:true});
  addLog('info', 'Открыт пример окна заполнения', fields.map(function(field){ return field.name; }).join(', '));
}

function uniqueFieldsFromGroups(groups){
  var fields = [];
  groups.forEach(function(group){
    group.fields.forEach(function(field){
      if(!fields.some(function(item){ return item.id === field.id; })) fields.push(field);
    });
  });
  return fields;
}

function runCheck(ruleId){
  var results = evaluateAllRules().filter(function(res){
    return !ruleId || res.rule.id === ruleId;
  });

  var triggered = 0;
  var launchedBpNames = [];
  var fillGroups = [];

  results.forEach(function(res){
    if(!res.rule.enabled || !res.evalRes.ok) return;
    triggered = triggered + 1;

    var action = res.actions || {};
    if(action.type === 'bp'){
      var bp = getBp(action.bpId);
      if(bp){
        launchedBpNames.push(bp.name);
        addLog('bp', 'Запущен бизнес-процесс «' + bp.name + '»', res.rule.title);
      }
    }

    if(action.type === 'fill' && action.fillFields.length){
      fillGroups.push({
        ruleId: res.rule.id,
        ruleTitle: res.rule.title,
        title: action.fillTitle,
        fields: action.fillFields
      });
    }
  });

  renderLog();

  if(fillGroups.length){
    var fields = uniqueFieldsFromGroups(fillGroups);
    var title = fillGroups.length === 1 ? fillGroups[0].title : 'Заполните обязательные поля';
    addLog('fill', 'Открыто окно заполнения', fields.map(function(field){ return field.name; }).join(', '));
    renderLog();
    openFillModal(fields, title, {preview:false, groups:fillGroups});
  } else if(triggered){
    toast('Условие выполнено. Запущено бизнес-процессов: ' + launchedBpNames.length, 'success');
  } else {
    var message = ruleId
      ? 'Условие правила не выполнено. Действия не запускаются.'
      : 'Ни одно правило не сработало.';
    addLog('info', message);
    renderLog();
    toast(message, 'info');
  }

  if(appState.activeTab === 'simulator') renderSimulationResults();
}

function addRule(){
  var leaf = createLeaf(nextUnusedFieldId({root:createGroup('and',[])}));
  var rule = createRule('Новое правило', 'and', [leaf]);
  appState.rules.push(rule);

  if(appState.activeTab !== 'rules') switchTab('rules');
  else refreshRules();

  addLog('info', 'Добавлено новое правило', rule.title);
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
  addLog(enabled ? 'success' : 'warning', 'Правило ' + (enabled ? 'включено' : 'отключено'), rule.title);
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
  addLog('info', 'Правило дублировано', clone.title);
  toast('Правило дублировано', 'success');
}

function confirmDeleteRule(ruleId){
  var rule = findRuleById(ruleId);
  if(!rule) return;

  openConfirm('Удалить правило?', 'Правило «' + (rule.title || 'без названия') + '» будет удалено.', function(){
    appState.rules = appState.rules.filter(function(item){ return item.id !== ruleId; });
    refreshRules();
    addLog('warning', 'Правило удалено', rule.title);
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
    addLog('warning', 'Элемент условия удалён', ctx.rule.title);
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

function applyFieldQuick(fieldId, mode){
  var field = getField(fieldId);
  if(!field) return;
  var st = ensureFieldState(fieldId);

  if(mode === 'clear'){
    st.curr = '';
  }
  if(mode === 'fill'){
    st.curr = sampleValue(field);
  }
  if(mode === 'change'){
    st.prev = st.curr;
    st.curr = sampleChangedValue(field);
  }

  renderSimulatorTab();
}

function applyScenario(mode){
  var fields = getSimulationFields();
  if(!fields.length){
    toast('Нет полей включённых правил', 'warning');
    return;
  }

  fields.forEach(function(field){
    var st = ensureFieldState(field.id);

    if(mode === 'clear'){
      st.prev = '';
      st.curr = '';
    }

    if(mode === 'fill'){
      st.prev = '';
      st.curr = sampleValue(field);
    }

    if(mode === 'change'){
      st.prev = sampleValue(field);
      st.curr = sampleChangedValue(field);
    }

    if(mode === 'random'){
      var rand = Math.random();
      if(rand < .25){
        st.prev = '';
        st.curr = '';
      } else if(rand < .5){
        st.prev = '';
        st.curr = sampleValue(field);
      } else if(rand < .75){
        st.prev = sampleValue(field);
        st.curr = sampleChangedValue(field);
      } else {
        st.prev = sampleValue(field);
        st.curr = '';
      }
    }
  });

  var labels = {
    clear:'все поля очищены',
    fill:'все поля заполнены',
    change:'все поля изменены',
    random:'случайный сценарий'
  };

  renderSimulatorTab();
  addLog('info', 'Применён тестовый сценарий', labels[mode] || mode);
}

function saveSettings(){
  var validation = validateAll();

  if(validation.errors.length){
    addLog('error', 'Сохранение отменено: есть ошибки конфигурации');
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
  var comboHit = event.target.closest('.fa-combo');
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
    case 'preview-rule-fill':
      previewRuleFill(el.dataset.ruleId);
      break;
    case 'sim-quick':
      applyFieldQuick(el.dataset.fieldId, el.dataset.mode);
      break;
    case 'sim-scenario':
      applyScenario(el.dataset.mode);
      break;
    case 'run-check':
      runCheck(el.dataset.ruleId || null);
      break;
    case 'run-tests':
      runLogicTests();
      break;
    case 'clear-log':
      appState.log = [];
      renderLog();
      toast('Журнал очищен', 'info');
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
    case 'submit-fill':
      submitFillModal();
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
      case 'set-rule-stage':{
        var rule = findRuleById(el.dataset.ruleId);
        if(rule){
          rule.stageId = el.value;
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

  if(action === 'fill-value'){
    clearFillError(el);
  }
}

function handleInput(event){
  var el = event.target;
  var action = el.dataset.action;
  if(!action) return;

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



  if(action === 'sim-value'){
    var st = ensureFieldState(el.dataset.fieldId);
    st[el.dataset.field] = el.value;
    updateFieldStatus(el.dataset.fieldId);
    renderSimulationResults();
    return;
  }

  if(action === 'fill-value'){
    clearFillError(el);
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
  FIELD_CATALOG.forEach(function(field){
    ensureFieldState(field.id);
  });

  appState.rules = createDemoRules();
  bindEvents();
  switchTab('rules');
  if(appState.rules.length){
    addLog('info', 'Загружено правил: ' + appState.rules.length);
  } else {
    addLog('info', 'Правил нет. Создайте первое правило.');
  }
}

BX.ready(init);

})();
