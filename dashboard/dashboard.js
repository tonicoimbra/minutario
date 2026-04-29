const TEMPLATE_PREFIX = 'tpl_';
const FOLDERS_KEY = 'folders';
const SETTINGS_KEY = 'settings';
const MAX_TEMPLATE_BYTES = 8192;
const MAX_TOTAL_BYTES = 102400;

const state = {
  templates: {},
  folders: [],
  activeFolderId: null,
  activeTemplateId: null,
  quill: null,
  settings: {
    triggerChar: '/',
    triggerKey: 'Space'
  }
};

const els = {};

document.addEventListener('DOMContentLoaded', async () => {
  cacheElements();
  initQuill();
  bindEvents();

  await loadStateFromStorage();
  renderFolderOptions();
  renderFolders();
  renderTemplateList();

  const initialTemplate = Object.values(state.templates)[0];
  if (initialTemplate) {
    selectTemplate(initialTemplate.id);
  } else {
    clearEditor();
  }
});

function cacheElements() {
  els.folderList = document.getElementById('folder-list');
  els.templateList = document.getElementById('template-list');
  els.search = document.getElementById('search');
  els.tplName = document.getElementById('tpl-name');
  els.tplShortcut = document.getElementById('tpl-shortcut');
  els.shortcutError = document.getElementById('shortcut-error');
  els.tplFolder = document.getElementById('tpl-folder');
  els.newFolderBtn = document.getElementById('new-folder');
  els.deleteFolderBtn = document.getElementById('delete-folder');
  els.newTemplateBtn = document.getElementById('new-template');
  els.editorForm = document.getElementById('editor-form');
  els.deleteTemplateBtn = document.getElementById('delete-template');
  els.toast = document.getElementById('toast');
}

function initQuill() {
  state.quill = new Quill('#quill-editor', {
    theme: 'snow',
    modules: {
      toolbar: [
        ['bold', 'italic', 'underline'],
        [{ header: 1 }, { header: 2 }],
        [{ list: 'ordered' }, { list: 'bullet' }]
      ]
    }
  });
}

function bindEvents() {
  els.search.addEventListener('input', () => {
    renderTemplateList();
  });

  els.newFolderBtn.addEventListener('click', createFolder);
  els.deleteFolderBtn.addEventListener('click', deleteActiveFolder);

  els.newTemplateBtn.addEventListener('click', () => {
    state.activeTemplateId = null;
    clearEditor();
    renderTemplateList();
  });

  els.tplShortcut.addEventListener('input', () => {
    const normalized = els.tplShortcut.value.trim().toLowerCase();
    els.tplShortcut.value = normalized;
    const error = getShortcutValidationMessage(normalized, true);
    showShortcutError(error);
  });

  els.editorForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveTemplate();
  });

  els.deleteTemplateBtn.addEventListener('click', async () => {
    await deleteTemplate();
  });

  document.getElementById('import-csv').addEventListener('change', handleCsvImport);
  document.getElementById('export-csv').addEventListener('click', handleCsvExport);
  document.getElementById('drive-backup').addEventListener('click', handleDriveBackup);
  document.getElementById('drive-restore').addEventListener('click', handleDriveRestore);
}

async function loadStateFromStorage() {
  const all = await chrome.storage.sync.get(null);
  const templates = {};

  Object.entries(all).forEach(([key, value]) => {
    if (key.startsWith(TEMPLATE_PREFIX) && value && typeof value === 'object') {
      const id = value.id || key.slice(TEMPLATE_PREFIX.length);
      templates[id] = { ...value, id };
    }
  });

  state.templates = templates;
  state.folders = Array.isArray(all[FOLDERS_KEY]) ? all[FOLDERS_KEY] : [];
  state.settings = {
    ...state.settings,
    ...(all[SETTINGS_KEY] || {})
  };
}

function renderFolders() {
  const fragment = document.createDocumentFragment();

  fragment.appendChild(buildFolderItem({ id: null, name: 'Todos' }));

  const sortedFolders = [...state.folders].sort((a, b) => (a.order || 0) - (b.order || 0));
  sortedFolders.forEach((folder) => {
    fragment.appendChild(buildFolderItem(folder));
  });

  els.folderList.innerHTML = '';
  els.folderList.appendChild(fragment);
  updateFolderActions();
}

function buildFolderItem(folder) {
  const li = document.createElement('li');
  li.className = 'folder-item';
  li.dataset.folderId = folder.id || '';
  li.textContent = folder.name;

  const isActive = (state.activeFolderId || null) === (folder.id || null);
  if (isActive) {
    li.classList.add('active');
  }

  li.addEventListener('click', () => {
    state.activeFolderId = folder.id || null;
    renderFolders();
    renderTemplateList();

    const visibleIds = getFilteredTemplates().map((tpl) => tpl.id);
    if (!visibleIds.includes(state.activeTemplateId)) {
      state.activeTemplateId = null;
      clearEditor();
    }
  });

  return li;
}

function renderFolderOptions() {
  const currentValue = state.activeTemplateId && state.templates[state.activeTemplateId]
    ? state.templates[state.activeTemplateId].folderId || ''
    : '';

  const options = ['<option value="">Todos</option>'];
  const sortedFolders = [...state.folders].sort((a, b) => (a.order || 0) - (b.order || 0));

  sortedFolders.forEach((folder) => {
    options.push(`<option value="${escapeHtmlAttr(folder.id)}">${escapeHtml(folder.name)}</option>`);
  });

  els.tplFolder.innerHTML = options.join('');
  els.tplFolder.value = currentValue;
}

async function createFolder() {
  const name = window.prompt('Nome da nova pasta:');
  if (!name) return;

  const trimmed = name.trim();
  if (!trimmed) return;

  const nextOrder = state.folders.reduce((max, folder) => {
    return Math.max(max, Number(folder.order) || 0);
  }, -1) + 1;

  const folder = {
    id: generateUUID(),
    name: trimmed,
    order: nextOrder
  };

  state.folders.push(folder);
  await chrome.storage.sync.set({ [FOLDERS_KEY]: state.folders });

  renderFolderOptions();
  renderFolders();
  showToast('Pasta criada com sucesso.', false);
}

async function deleteActiveFolder() {
  if (!state.activeFolderId) {
    showToast('Selecione uma pasta para excluir.', true);
    return;
  }

  const folder = state.folders.find((item) => item.id === state.activeFolderId);
  if (!folder) {
    showToast('Pasta não encontrada.', true);
    return;
  }

  const confirmed = window.confirm(`Excluir pasta "${folder.name}"? Os templates serão movidos para Todos.`);
  if (!confirmed) return;

  const folderId = state.activeFolderId;
  const updates = {
    [FOLDERS_KEY]: state.folders.filter((item) => item.id !== folderId)
  };

  Object.values(state.templates).forEach((template) => {
    if (template.folderId === folderId) {
      const updatedTemplate = { ...template, folderId: null, updatedAt: Date.now() };
      updates[`${TEMPLATE_PREFIX}${template.id}`] = updatedTemplate;
      state.templates[template.id] = updatedTemplate;
    }
  });

  state.folders = updates[FOLDERS_KEY];
  state.activeFolderId = null;

  await chrome.storage.sync.set(updates);

  renderFolderOptions();
  renderFolders();
  renderTemplateList();
  showToast('Pasta excluída. Templates movidos para Todos.', false);
}

function updateFolderActions() {
  if (!els.deleteFolderBtn) {
    return;
  }

  els.deleteFolderBtn.disabled = !state.activeFolderId;
}

function renderTemplateList() {
  const templates = getFilteredTemplates();
  els.templateList.innerHTML = '';

  if (!templates.length) {
    const empty = document.createElement('li');
    empty.className = 'template-item';
    empty.textContent = 'Nenhum template encontrado.';
    els.templateList.appendChild(empty);
    return;
  }

  templates.forEach((template) => {
    const item = document.createElement('li');
    item.className = 'template-item';
    if (state.activeTemplateId === template.id) {
      item.classList.add('active');
    }

    const previewText = stripHtml(template.content || '').slice(0, 60);

    item.innerHTML = [
      `<div class="template-name">${escapeHtml(template.name || 'Sem nome')}</div>`,
      `<div class="template-shortcut">/${escapeHtml(template.shortcut || '')}</div>`,
      `<div class="template-preview">${escapeHtml(previewText)}</div>`
    ].join('');

    item.addEventListener('click', () => {
      selectTemplate(template.id);
    });

    els.templateList.appendChild(item);
  });
}

function getFilteredTemplates() {
  const query = els.search.value.trim().toLowerCase();

  return Object.values(state.templates)
    .filter((template) => {
      if (state.activeFolderId && template.folderId !== state.activeFolderId) {
        return false;
      }

      if (!query) {
        return true;
      }

      const haystack = `${template.name || ''} ${template.shortcut || ''}`.toLowerCase();
      return haystack.includes(query);
    })
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

function selectTemplate(id) {
  const template = state.templates[id];
  if (!template) return;

  state.activeTemplateId = id;

  els.tplName.value = template.name || '';
  els.tplShortcut.value = template.shortcut || '';
  renderFolderOptions();
  els.tplFolder.value = template.folderId || '';
  state.quill.root.innerHTML = template.content || '';

  showShortcutError('');
  renderTemplateList();
}

function clearEditor() {
  els.tplName.value = '';
  els.tplShortcut.value = '';
  els.tplFolder.value = '';
  state.quill.setText('');
  showShortcutError('');
}

function getShortcutValidationMessage(shortcut, allowEmpty) {
  if (!shortcut) {
    return allowEmpty ? '' : 'Atalho é obrigatório.';
  }
  if (shortcut.length > 30) {
    return 'O atalho deve ter no máximo 30 caracteres.';
  }
  if (!/^[a-z0-9-]+$/.test(shortcut)) {
    return 'Use apenas letras minúsculas, números e hífen.';
  }
  return '';
}

function showShortcutError(message) {
  els.shortcutError.textContent = message || '';
}

async function saveTemplate() {
  const name = els.tplName.value.trim();
  const shortcut = els.tplShortcut.value.trim().toLowerCase();
  const folderId = els.tplFolder.value || null;

  els.tplShortcut.value = shortcut;

  if (!name) {
    showToast('Nome do template é obrigatório.', true);
    return;
  }

  const shortcutError = getShortcutValidationMessage(shortcut, false);
  if (shortcutError) {
    showShortcutError(shortcutError);
    return;
  }

  const conflict = Object.values(state.templates).find((tpl) => {
    return tpl.shortcut === shortcut && tpl.id !== state.activeTemplateId;
  });

  if (conflict) {
    showShortcutError(`Atalho já em uso pelo template "${conflict.name}".`);
    return;
  }

  showShortcutError('');

  const now = Date.now();
  const existing = state.activeTemplateId ? state.templates[state.activeTemplateId] : null;
  const id = existing ? existing.id : generateUUID();

  const candidate = {
    id,
    name,
    shortcut,
    content: state.quill.root.innerHTML,
    folderId,
    createdAt: existing ? existing.createdAt : now,
    updatedAt: now
  };

  const candidateBytes = getBytesLength(JSON.stringify(candidate));
  if (candidateBytes > MAX_TEMPLATE_BYTES) {
    showToast(
      `Template size: ${candidateBytes} / ${MAX_TEMPLATE_BYTES} bytes.\nDelete old templates or shorten content to save space.`,
      true
    );
    return;
  }

  const allStorage = await chrome.storage.sync.get(null);
  const currentTotalBytes = Object.entries(allStorage).reduce((total, [key, value]) => {
    if (!key.startsWith(TEMPLATE_PREFIX) || !value || typeof value !== 'object') {
      return total;
    }
    if (key === `${TEMPLATE_PREFIX}${id}`) {
      return total;
    }
    return total + getBytesLength(JSON.stringify(value));
  }, 0);

  const projectedTotal = currentTotalBytes + candidateBytes;
  if (projectedTotal > MAX_TOTAL_BYTES) {
    showToast(
      `Total sync size: ${projectedTotal} / ${MAX_TOTAL_BYTES} bytes.\nDelete old templates or shorten content to save space.`,
      true
    );
    return;
  }

  await chrome.storage.sync.set({ [`${TEMPLATE_PREFIX}${id}`]: candidate });
  state.templates[id] = candidate;
  state.activeTemplateId = id;

  renderTemplateList();
  selectTemplate(id);
  showToast('Template salvo com sucesso.', false);
}

async function deleteTemplate() {
  if (!state.activeTemplateId) {
    showToast('Selecione um template para excluir.', true);
    return;
  }

  const template = state.templates[state.activeTemplateId];
  const confirmed = window.confirm(`Excluir template "${template.name}"?`);
  if (!confirmed) return;

  const id = state.activeTemplateId;
  await chrome.storage.sync.remove(`${TEMPLATE_PREFIX}${id}`);

  delete state.templates[id];
  state.activeTemplateId = null;

  renderTemplateList();
  clearEditor();
  showToast('Template excluído.', false);
}

async function handleCsvImport(event) {
  var file = event.target.files[0];
  if (!file) return;

  var text = await file.text();
  var parsed = CsvSync.parseCsv(text);

  if (!parsed.success) {
    showToast('Erro no CSV: ' + parsed.errors.join(', '), true);
    return;
  }

  var result = CsvSync.importCsv(parsed.data, state.templates, state.folders);

  if (result.conflicts.length > 0) {
    var names = result.conflicts.map(function (c) { return '/' + c.shortcut; }).join(', ');
    var confirmed = window.confirm(
      'Conflitos detectados nos atalhos: ' + names + '\n\nDeseja sobrescrever os templates existentes?'
    );
    if (!confirmed) {
      showToast('Importação cancelada.', true);
      return;
    }
  }

  var now = Date.now();
  var updates = {};

  result.templates.forEach(function (item) {
    var existingId = null;
    Object.values(state.templates).forEach(function (tpl) {
      if (tpl.shortcut === item.shortcut) {
        existingId = tpl.id;
      }
    });

    var id = existingId || generateUUID();
    var tpl = {
      id: id,
      name: item.name,
      shortcut: item.shortcut,
      content: item.content,
      folderId: item.folderId,
      createdAt: existingId ? state.templates[existingId].createdAt : now,
      updatedAt: now,
    };

    updates[TEMPLATE_PREFIX + id] = tpl;
    state.templates[id] = tpl;
  });

  await chrome.storage.sync.set(updates);
  renderTemplateList();
  showToast('Importados ' + result.stats.created + ' templates.', false);
  event.target.value = '';
}

async function handleCsvExport() {
  var rows = Object.values(state.templates).map(function (tpl) {
    var folderName = '';
    if (tpl.folderId) {
      var folder = state.folders.find(function (f) { return f.id === tpl.folderId; });
      folderName = folder ? folder.name : '';
    }
    return {
      name: tpl.name,
      shortcut: tpl.shortcut,
      folder: folderName,
      content: tpl.content,
    };
  });

  var csv = Papa.unparse(rows, {
    columns: ['name', 'shortcut', 'folder', 'content'],
  });

  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url;
  a.download = 'minutario-templates.csv';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('CSV exportado com sucesso.', false);
}

async function handleDriveBackup() {
  try {
    var data = await chrome.storage.sync.get(null);
    var result = await DriveSync.backup(data);
    showToast('Backup salvo no Google Drive.', false);
  } catch (error) {
    showToast('Erro no backup: ' + error.message, true);
  }
}

async function handleDriveRestore() {
  try {
    var confirmed = window.confirm('Restaurar do Drive? Isso substituirá todos os templates locais.');
    if (!confirmed) return;

    var result = await DriveSync.restore();
    if (!result.success) {
      showToast(result.error, true);
      return;
    }

    await chrome.storage.sync.clear();
    await chrome.storage.sync.set(result.data);
    await loadStateFromStorage();
    renderFolders();
    renderFolderOptions();
    renderTemplateList();
    clearEditor();
    showToast('Templates restaurados do Google Drive.', false);
  } catch (error) {
    showToast('Erro na restauração: ' + error.message, true);
  }
}

function showToast(message, isError) {
  const toastItem = document.createElement('div');
  toastItem.className = `toast-item ${isError ? 'error' : 'success'}`;
  toastItem.textContent = message;

  (els.toast || document.body).appendChild(toastItem);

  window.setTimeout(() => {
    toastItem.remove();
  }, 3000);
}

function generateUUID() {
  return crypto.randomUUID();
}

function stripHtml(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html || '', 'text/html');
  return (doc.body.textContent || '').trim();
}

function getBytesLength(value) {
  return new TextEncoder().encode(value).length;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function escapeHtmlAttr(value) {
  return escapeHtml(value).replaceAll('`', '&#96;');
}
