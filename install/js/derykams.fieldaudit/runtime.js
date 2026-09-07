(function () {
  'use strict';
  if (!window.BX || BX.FieldAuditRuntime) return;

  var activeToken = null;
  var popup = null;
  var seen = Object.create(null);
  var queue = [];
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
    var data = body instanceof FormData ? body : new FormData();
    if (!(body instanceof FormData)) {
      Object.keys(body).forEach(function (key) { data.append(key, body[key]); });
    }
    data.append('sessid', BX.bitrix_sessid());
    return fetch('/bitrix/services/main/ajax.php?action=derykams:fieldaudit.FillController.' + action, {
      method: 'POST', credentials: 'same-origin', body: data
    }).then(function (response) {
      if (!response.ok) throw new Error('Сервер недоступен (' + response.status + '). Повторите попытку.');
      return response.json();
    }).then(function (response) {
      if (response.status !== 'success') {
        var error = new Error((response.errors || []).map(function (item) { return clean(item.message); }).join('\n') || 'Не удалось сохранить сделку.');
        error.tokens = tokens(response.errors);
        throw error;
      }
      return response.data;
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
          submitting = false;
          save.setName('Сохранить и продолжить');
          save.getContainer().removeAttribute('aria-disabled');
          cancel.getContainer().removeAttribute('aria-disabled');
          errorBox.textContent = error.message;
        });
      }}
    });
    var cancel = new BX.PopupWindowButtonLink({text: 'Отмена', events: {click: function () { if (!submitting) popup.close(); }}});
    popup = new BX.PopupWindow('derykams-fieldaudit-fill', null, {
      titleBar: data.requirements.length === 1 ? (data.requirements[0].title || data.title) : data.title,
      content: root, width: Math.min(620, window.innerWidth - 32), overlay: true,
      autoHide: false, closeByEsc: false, closeIcon: false,
      buttons: [save, cancel],
      events: {onPopupClose: function () {
        this.destroy(); popup = null; activeToken = null; next();
      }}
    });
    popup.show();
    var first = root.querySelector('input:not(:disabled),select:not(:disabled),textarea:not(:disabled)');
    if (first) first.focus();
  }

  function next() {
    if (activeToken || !queue.length) return;
    activeToken = queue.shift();
    request('load', {token: activeToken}).then(show).catch(function (error) {
      var content = node('div', error.message, 'fa-runtime-error');
      var failed = new BX.PopupWindow('derykams-fieldaudit-error', null, {
        titleBar: 'Не удалось открыть заполнение', content: content, overlay: true,
        closeIcon: true, closeByEsc: true,
        events: {onPopupClose: function () { this.destroy(); activeToken = null; next(); }}
      });
      failed.show();
    });
  }

  function onResponse(response) {
    tokens(response).forEach(function (token) {
      if (!seen[token]) { seen[token] = true; queue.push(token); }
    });
    next();
  }

  BX.FieldAuditRuntime = {onResponse: onResponse};
  // legacy progressbar / kanban и D7 runAction проходят через BX.ajax.
  BX.addCustomEvent('onAjaxSuccess', onResponse);
  BX.addCustomEvent('onAjaxFailure', function (type, error) { onResponse(error); });
})();
