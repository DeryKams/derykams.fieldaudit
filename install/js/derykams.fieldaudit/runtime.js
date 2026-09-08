(function () {
  'use strict';
  var logRecords = [];
  function log(event, details, level) {
    var record = {time: new Date().toISOString(), event: event, data: details || {}};
    logRecords.push(record);
    if (logRecords.length > 200) logRecords.shift();
    if (window.console && typeof console[level || 'info'] === 'function') {
      console[level || 'info']('[FieldAudit] ' + event, record.data);
    }
  }

  function initialize() {
  if (!window.BX || typeof BX.addCustomEvent !== 'function') return false;
  if (BX.FieldAuditRuntime) return true;

  var activeToken = null;
  var popup = null;
  var seen = Object.create(null);
  var queue = [];
  var progressControls = Object.create(null);
  var debugSeen = Object.create(null);
  var marker = /\[DERYKAMS_FIELDAUDIT:([a-f0-9]{48})\]/g;

  function clean(value) {
    return String(value || '').replace(marker, '').trim();
  }

  function tokens(value, result, depth) {
    result = result || [];
    depth = depth || 0;
    if (depth > 12 || value === null || value === undefined) return result;
    if (typeof value === 'string') {
      var match;
      marker.lastIndex = 0;
      while ((match = marker.exec(value))) {
        if (result.indexOf(match[1]) < 0) result.push(match[1]);
      }
    } else if (Array.isArray(value) || Object.prototype.toString.call(value) === '[object Object]') {
      Object.keys(value).forEach(function (key) { tokens(value[key], result, depth + 1); });
    }
    return result;
  }

  function request(action, body) {
    log('request.begin', {action: action, challenge: (activeToken || '').slice(0, 8)});
    var data = body instanceof FormData ? body : new FormData();
    if (!(body instanceof FormData)) {
      Object.keys(body).forEach(function (key) { data.append(key, body[key]); });
    }
    data.append('sessid', BX.bitrix_sessid());
    return fetch('/bitrix/services/main/ajax.php?action=derykams:fieldaudit.FillController.' + action, {
      method: 'POST', credentials: 'same-origin', body: data
    }).then(function (response) {
      readDiagnostics(response.headers.get('X-Derykams-FieldAudit-Debug'));
      if (!response.ok) throw new Error('Сервер недоступен (' + response.status + '). Повторите попытку.');
      return response.json();
    }).then(function (response) {
      if (response.status !== 'success') {
        var error = new Error((response.errors || []).map(function (item) { return clean(item.message); }).join('\n') || 'Не удалось сохранить сделку.');
        error.tokens = tokens(response.errors);
        throw error;
      }
      log('request.success', {action: action, dealId: response.data && response.data.dealId});
      return response.data;
    });
  }

  function readDiagnostics(trace) {
    if (!trace || !/^[a-f0-9]{32}$/.test(trace) || debugSeen[trace]) return;
    debugSeen[trace] = true;
    var keys = Object.keys(debugSeen);
    if (keys.length > 200) delete debugSeen[keys[0]];
    request('trace', {trace: trace}).then(function (data) {
      (data.records || []).forEach(function (record) {
        log('server.' + record.event, {trace: trace, serverTime: record.time, details: record.data});
      });
      if (data.truncated) log('server.trace_truncated', {trace: trace}, 'warn');
    }).catch(function (error) {
      log('server.trace_error', {trace: trace, message: clean(error.message)}, 'warn');
    });
  }

  function node(tag, text, className) {
    var el = document.createElement(tag);
    if (text !== undefined && text !== null) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  function createInput(field) {
    var input;
    if (field.type === 'enumeration' || field.type === 'boolean') {
      input = node('select');
      input.multiple = Boolean(field.multiple);
      var entries = field.type === 'boolean' ? [{id: '1', name: 'Да'}, {id: '0', name: 'Нет'}] : field.items;
      if (!input.multiple) input.appendChild(new Option('Не выбрано', ''));
      (entries || []).forEach(function (item) {
        var selected = (Array.isArray(field.value) ? field.value.map(String) : [String(field.value)]).indexOf(String(item.id)) >= 0;
        input.appendChild(new Option(item.name, item.id, false, selected));
      });
    } else if (field.multiple && field.type !== 'file') {
      input = node('textarea');
      input.value = (Array.isArray(field.value) ? field.value : [field.value || '']).join('\n');
      input.placeholder = 'Каждое значение с новой строки';
    } else {
      input = node('input');
      input.type = field.type === 'file' ? 'file' : 'text';
      if (field.type !== 'file') input.value = field.value === null ? '' : String(field.value || '');
      if (field.type === 'date' || field.type === 'datetime') input.placeholder = 'Дата в формате вашего портала';
    }
    input.id = 'fa-fill-' + field.id;
    input.className = 'fa-runtime-input';
    input.disabled = !field.editable;
    return input;
  }

  function show(data) {
    log('popup.build', {dealId: data.dealId, fieldIds: data.fields.map(function (field) { return field.id; }), requirements: data.requirements});
    var root = node('div', null, 'fa-runtime');
    var instructions = node('div', null, 'fa-runtime-requirements');
    var byId = {};
    data.fields.forEach(function (field) { byId[field.id] = field; });
    data.requirements.forEach(function (requirement) {
      var names = requirement.fieldIds.map(function (id) { return byId[id] ? byId[id].name : id; });
      instructions.appendChild(node('p', (requirement.mode === 'any' ? 'Заполните хотя бы одно из полей (можно все): ' : 'Заполните все поля: ') + names.join(', ')));
    });
    root.appendChild(instructions);
    var controls = {};
    data.fields.forEach(function (field) {
      var block = node('div', null, 'fa-runtime-field');
      var label = node('label', field.name);
      label.htmlFor = 'fa-fill-' + field.id;
      block.appendChild(label);
      var input = createInput(field);
      controls[field.id] = input;
      block.appendChild(input);
      if (field.type === 'file' && field.filled) block.appendChild(node('small', 'Файл уже заполнен. Можно оставить его или выбрать новый.'));
      if (!field.editable) block.appendChild(node('small', 'Заполните это поле в карточке сделки и повторите перемещение.'));
      root.appendChild(block);
    });
    var errorBox = node('div', '', 'fa-runtime-error');
    errorBox.setAttribute('role', 'alert');
    root.appendChild(errorBox);
    var submitting = false;

    var save = new BX.PopupWindowButton({
      text: 'Сохранить и продолжить', className: 'popup-window-button-accept',
      events: {click: function () {
        if (submitting) return;
        var values = {};
        var filled = {};
        var form = new FormData();
        form.append('token', data.token);
        data.fields.forEach(function (field) {
          var input = controls[field.id];
          filled[field.id] = field.filled;
          if (!field.editable) return;
          if (field.type === 'file') {
            if (input.files && input.files[0]) {
              form.append('upload_' + field.id, input.files[0]);
              filled[field.id] = true;
            }
          } else {
            var value = field.multiple
              ? (input.tagName === 'SELECT' ? Array.from(input.selectedOptions).map(function (option) { return option.value; }) : input.value.split('\n').map(function (line) { return line.trim(); }).filter(Boolean))
              : input.value.trim();
            filled[field.id] = Array.isArray(value) ? value.length > 0 : value !== '';
            // Не перезаписываем неизменённые поля, включая пустые альтернативы.
            if (JSON.stringify(value) !== JSON.stringify(field.value)) values[field.id] = value;
          }
        });
        var missing = data.requirements.some(function (requirement) {
          var matches = requirement.fieldIds.map(function (id) { return Boolean(filled[id]); });
          return requirement.mode === 'any' ? !matches.some(Boolean) : !matches.every(Boolean);
        });
        log('popup.fill_check', {dealId: data.dealId, filled: filled, satisfied: !missing});
        if (missing) { errorBox.textContent = 'Выполните указанные условия заполнения.'; return; }
        form.append('valuesJson', JSON.stringify(values));
        submitting = true;
        save.setName('Сохранение…');
        save.getContainer().setAttribute('aria-disabled', 'true');
        cancel.getContainer().setAttribute('aria-disabled', 'true');
        errorBox.textContent = '';
        request('save', form).then(function (result) {
          if (BX.Crm && BX.Crm.EntityEvent) BX.Crm.EntityEvent.fireUpdate(2, result.dealId);
          // Обновление показывает сохранённые значения и фактическую стадию на обеих страницах.
          window.location.reload();
        }).catch(function (error) {
          log('popup.save_error', {message: clean(error.message)}, 'error');
          submitting = false;
          save.setName('Сохранить и продолжить');
          save.getContainer().removeAttribute('aria-disabled');
          cancel.getContainer().removeAttribute('aria-disabled');
          errorBox.textContent = error.message;
        });
      }}
    });
    var cancel = new BX.PopupWindowButtonLink({text: 'Отмена', events: {click: function () {
      if (!submitting) {
        log('popup.cancel', {dealId: data.dealId, challenge: data.token.slice(0, 8)});
        popup.close();
      }
    }}});
    popup = new BX.PopupWindow('derykams-fieldaudit-fill', null, {
      titleBar: data.requirements.length === 1 ? (data.requirements[0].title || data.title) : data.title,
      content: root, width: Math.min(620, window.innerWidth - 32), overlay: true,
      autoHide: false, closeByEsc: false, closeIcon: false,
      buttons: [save, cancel],
      events: {onPopupClose: function () {
        log('popup.closed', {dealId: data.dealId});
        this.destroy(); popup = null; activeToken = null; next();
      }}
    });
    popup.show();
    log('popup.shown', {dealId: data.dealId, challenge: data.token.slice(0, 8)});
    var first = root.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled)');
    if (first) first.focus();
  }

  function ensurePopup() {
    if (BX.PopupWindow && BX.PopupWindowButton && BX.PopupWindowButtonLink) return Promise.resolve();
    log('popup.extension_load');
    if (BX.Runtime && BX.Runtime.loadExtension) {
      return BX.Runtime.loadExtension('main.popup').then(function () {
        if (!BX.PopupWindow || !BX.PopupWindowButton || !BX.PopupWindowButtonLink) {
          throw new Error('Расширение main.popup загружено без API PopupWindow.');
        }
      });
    }
    return Promise.reject(new Error('API окна Битрикс не загружено. Обновите страницу CRM.'));
  }

  function next() {
    if (activeToken || !queue.length) return;
    activeToken = queue.shift();
    log('challenge.open', {challenge: activeToken.slice(0, 8), queued: queue.length});
    ensurePopup().then(function () {
      return request('load', {token: activeToken});
    }).then(show).catch(function (error) {
      log('popup.open_error', {challenge: (activeToken || '').slice(0, 8), message: clean(error.message)}, 'error');
      if (popup) { popup.destroy(); popup = null; }
      if (!BX.PopupWindow) {
        window.alert('Не удалось открыть заполнение: ' + clean(error.message));
        activeToken = null;
        next();
        return;
      }
      var content = node('div', error.message, 'fa-runtime-error');
      var failed = new BX.PopupWindow('derykams-fieldaudit-error', null, {
        titleBar: 'Не удалось открыть заполнение', content: content, overlay: true,
        closeIcon: true, closeByEsc: true,
        events: {onPopupClose: function () { this.destroy(); activeToken = null; next(); }}
      });
      failed.show();
    });
  }

  function onResponse(response, config) {
    var found = tokens(response);
    var xhr = config && config.xhr;
    var fromHeader = [];
    if (xhr && typeof xhr.getResponseHeader === 'function') {
      try {
        readDiagnostics(xhr.getResponseHeader('X-Derykams-FieldAudit-Debug'));
        fromHeader = (xhr.getResponseHeader('X-Derykams-FieldAudit') || '').split(',').map(function (value) { return value.trim(); })
          .filter(function (value) { return /^[a-f0-9]{48}$/.test(value); });
        fromHeader.forEach(function (token) { if (found.indexOf(token) < 0) found.push(token); });
        // В том числе ошибка обработчика CRM до отправки onAjaxSuccess.
        tokens(xhr.responseText, found);
      } catch (error) {
        log('response.read_error', {message: clean(error.message)}, 'warn');
      }
    }
    var url = config && typeof config.url === 'string' ? config.url.split('?')[0] : '';
    if (found.length || /\/crm[./]/.test(url)) {
      log('response.received', {url: url, status: xhr && xhr.status, headerSignals: fromHeader.length,
        challenges: found.map(function (token) { return token.slice(0, 8); })});
    }
    // SAVE_PROGRESS возвращает VALUE прежней стадии даже без ERROR/CHECK_ERRORS.
    // Его штатный success-handler уже выполнился; восстанавливаем индикатор явно.
    if (found.length && response && response.TYPE === 'DEAL' && response.VALUE && progressControls[response.ID]) {
      var control = progressControls[response.ID];
      delete progressControls[response.ID];
      if (typeof control.setCurrentStepByIdAndAdjustSteps === 'function') {
        try {
          control.setCurrentStepByIdAndAdjustSteps(response.VALUE);
          log('stage.restored', {dealId: response.ID, stageId: response.VALUE});
        } catch (error) { log('stage.restore_error', {message: clean(error.message)}, 'warn'); }
      }
    }
    found.forEach(function (token) {
      if (!seen[token]) { seen[token] = true; queue.push(token); }
    });
    next();
  }

  BX.FieldAuditRuntime = {onResponse: onResponse, getLog: function () { return logRecords.slice(); }};
  // legacy progressbar / kanban и D7 runAction проходят через BX.ajax.
  BX.addCustomEvent('onAjaxSuccess', onResponse);
  BX.addCustomEvent('onAjaxFailure', function (type, error, config) { onResponse(error, config); });
  BX.addCustomEvent('Crm.EntityProgress.onSaveBefore', function (control, data) {
    if (!data || data.TYPE !== 'DEAL') return;
    progressControls[data.ID] = control;
    log('stage.request', {dealId: data.ID, stageId: data.VALUE, source: 'progressbar'});
  });
  log('runtime.ready', {path: window.location.pathname, popupApi: Boolean(BX.PopupWindow), transport: 'header+message'});
  return true;
  }

  if (!initialize()) {
    log('runtime.waiting_for_BX', {}, 'warn');
    document.addEventListener('DOMContentLoaded', initialize, {once: true});
    window.addEventListener('load', function () {
      if (!initialize()) log('runtime.init_failed', {reason: 'BX API unavailable'}, 'error');
    }, {once: true});
  }
})();
