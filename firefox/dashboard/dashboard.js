(function() {
  "use strict";

  // State
  var allTemplates = [];
  var filteredTemplates = [];
  var debounceTimer = null;
  var realtimeSubscription = null;
  var userId = null;
  var currentTemplateId = null;
  var allFolders = [];
  var activeFolderId = null;
  var quill = null;

  // DOM cache
  var els = {};

  function cacheElements() {
    els.loginScreen = document.getElementById("login-screen");
    els.dashboardScreen = document.getElementById("dashboard-screen");
    els.loginForm = document.getElementById("login-form");
    els.loginEmail = document.getElementById("login-email");
    els.loginPassword = document.getElementById("login-password");
    els.loginError = document.getElementById("login-error");
    els.logoutBtn = document.getElementById("logout-btn");
    els.searchInput = document.getElementById("search-input") || document.getElementById("search");
    els.templateList = document.getElementById("template-list");
    els.emptyState = document.getElementById("empty-state");
    els.syncBadge = document.getElementById("sync-badge");
    els.toast = document.getElementById("toast");
    els.importCsvInput = document.getElementById("import-csv");
    els.exportCsvBtn = document.getElementById("export-csv");
    els.importStatus = document.getElementById("import-status");

    // Editor elements
    els.editorForm = document.getElementById("editor-form");
    els.tplName = document.getElementById("tpl-name");
    els.tplShortcut = document.getElementById("tpl-shortcut");
    els.tplFolder = document.getElementById("tpl-folder");
    els.shortcutError = document.getElementById("shortcut-error");
    els.newTemplateBtn = document.getElementById("new-template");
    els.deleteTemplateBtn = document.getElementById("delete-template");
    els.folderList = document.getElementById("folder-list");
    els.newFolderBtn = document.getElementById("new-folder");
    els.deleteFolderBtn = document.getElementById("delete-folder");
    els.quillEditor = document.getElementById("quill-editor");
  }

  // Utilities
  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function stripHtml(html) {
    if (!html) return "";
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }

  function showToast(message) {
    if (!els.toast) return;
    var item = document.createElement("div");
    item.className = "toast-item";
    item.textContent = message;
    els.toast.appendChild(item);
    window.setTimeout(function() {
      item.remove();
    }, 2500);
  }

  function setImportStatus(message, isError) {
    if (!els.importStatus) return;
    els.importStatus.textContent = message || "";
    els.importStatus.classList.toggle("error", !!isError);
  }

  function getCurrentDateString() {
    var now = new Date();
    var year = now.getFullYear();
    var month = String(now.getMonth() + 1).padStart(2, "0");
    var day = String(now.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function readFileAsText(file) {
    if (!file) {
      return Promise.reject(new Error("Nenhum arquivo selecionado"));
    }

    if (typeof file.text === "function") {
      return file.text();
    }

    return new Promise(function(resolve, reject) {
      var reader = new FileReader();
      reader.onload = function() {
        resolve(String(reader.result || ""));
      };
      reader.onerror = function() {
        reject(reader.error || new Error("Falha ao ler o arquivo CSV"));
      };
      reader.readAsText(file, "utf-8");
    });
  }

  function triggerCsvDownload(csvText, filename) {
    if (!csvText) {
      throw new Error("CSV vazio");
    }

    var blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    var objectUrl = URL.createObjectURL(blob);
    var link = document.createElement("a");

    link.href = objectUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();

    window.setTimeout(function() {
      URL.revokeObjectURL(objectUrl);
    }, 1000);
  }

  function getFolderOrder(folder) {
    if (!folder) return 0;
    if (typeof folder.order_idx === "number") return folder.order_idx;
    if (typeof folder.order === "number") return folder.order;
    return 0;
  }

  function sortFolders(folders) {
    return (folders || []).slice().sort(function(a, b) {
      var orderDiff = getFolderOrder(a) - getFolderOrder(b);
      if (orderDiff !== 0) return orderDiff;
      return String(a.name || "").localeCompare(String(b.name || ""));
    });
  }

  function notifyTemplatesUpdated() {
    if (!window.browser || !browser.tabs || !browser.tabs.query || !browser.tabs.sendMessage) {
      return Promise.resolve();
    }

    return browser.tabs.query({}).then(function(tabs) {
      return Promise.all((tabs || []).map(function(tab) {
        if (typeof tab.id !== "number") {
          return Promise.resolve();
        }
        return browser.tabs.sendMessage(tab.id, { type: "TEMPLATES_UPDATED" }).catch(function() {
          return undefined;
        });
      }));
    }).then(function() {
      return undefined;
    }).catch(function() {
      return undefined;
    });
  }

  // Auth helpers
  function getStoredTokens() {
    return {
      accessToken: localStorage.getItem("minutario_access_token"),
      refreshToken: localStorage.getItem("minutario_refresh_token")
    };
  }

  function saveTokens(session) {
    localStorage.setItem("minutario_access_token", session.access_token);
    localStorage.setItem("minutario_refresh_token", session.refresh_token);
  }

  function clearTokens() {
    localStorage.removeItem("minutario_access_token");
    localStorage.removeItem("minutario_refresh_token");
    localStorage.removeItem("minutario_user_id");
  }

function getUserIdFromUser(user) {
    return (user && user.id) || null;
  }

  async function getStoredUserId() {
    var storedUserId = localStorage.getItem("minutario_user_id");
    if (storedUserId) return storedUserId;

    if (window.browser && browser.storage && browser.storage.local && browser.storage.local.get) {
      var result = await browser.storage.local.get("minutario_user_id");
      return result && result.minutario_user_id ? result.minutario_user_id : null;
    }

    return null;
  }

  async function saveUserId(value) {
    if (!value) return;
    userId = value;
    localStorage.setItem("minutario_user_id", value);

    if (window.browser && browser.storage && browser.storage.local && browser.storage.local.set) {
      await browser.storage.local.set({ minutario_user_id: value });
    }
  }

  // Screen management
  function showLoginScreen() {
    if (els.loginScreen) els.loginScreen.classList.remove("hidden");
    if (els.dashboardScreen) els.dashboardScreen.classList.add("hidden");
  }

  function showDashboardScreen() {
    if (els.loginScreen) els.loginScreen.classList.add("hidden");
    if (els.dashboardScreen) els.dashboardScreen.classList.remove("hidden");
  }

  function getFolderById(id) {
    for (var i = 0; i < allFolders.length; i++) {
      if (allFolders[i].id === id) return allFolders[i];
    }
    return null;
  }

  function setActiveFolder(folderId) {
    activeFolderId = folderId || null;
    renderFolderList();
    filterAndRender();
    if (els.deleteFolderBtn) {
      els.deleteFolderBtn.disabled = !activeFolderId;
    }
  }

  function populateFolderSelect() {
    if (!els.tplFolder) return;

    els.tplFolder.innerHTML = "";

    var emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "Sem pasta";
    els.tplFolder.appendChild(emptyOption);

    sortFolders(allFolders).forEach(function(folder) {
      var option = document.createElement("option");
      option.value = folder.id;
      option.textContent = folder.name || "Sem nome";
      els.tplFolder.appendChild(option);
    });
  }

  function renderFolderList() {
    if (!els.folderList) return;
    els.folderList.innerHTML = "";

    sortFolders(allFolders).forEach(function(folder) {
      var li = document.createElement("li");
      li.className = "folder-item";
      if (folder.id === activeFolderId) {
        li.classList.add("active");
      }
      li.textContent = folder.name || "Sem nome";
      li.dataset.id = folder.id;
      li.addEventListener("click", function() {
        setActiveFolder(folder.id === activeFolderId ? null : folder.id);
      });
      els.folderList.appendChild(li);
    });
  }

  async function loadFolders() {
    try {
      if (window.MinutarioDB && window.MinutarioDB.getAllFolders) {
        allFolders = await window.MinutarioDB.getAllFolders();
      } else {
        allFolders = [];
      }
      populateFolderSelect();
      renderFolderList();
      if (els.deleteFolderBtn) {
        els.deleteFolderBtn.disabled = !activeFolderId;
      }
    } catch (err) {
      console.error("Load folders error:", err);
      showToast("Erro ao carregar pastas");
    }
  }

  // Sync badge (optional if not in DOM)
  function updateSyncBadge(state) {
    var badge = els.syncBadge;
    if (!badge) return;
    badge.className = "sync-badge";
    if (state === "idle") {
      badge.classList.add("sync-idle");
      badge.textContent = "Sincronizado";
    } else if (state === "syncing") {
      badge.classList.add("sync-syncing");
      badge.textContent = "Sincronizando...";
    } else if (state === "updated") {
      badge.classList.add("sync-updated");
      badge.textContent = "Atualizado";
    } else if (state === "error" || state === "offline") {
      badge.classList.add("sync-error");
      badge.textContent = "Erro";
    }
  }

  // Login
  async function handleLogin(event) {
    event.preventDefault();
    var email = els.loginEmail.value.trim();
    var password = els.loginPassword.value;

    try {
      var client = window.MinutarioAPI.getClient();
      if (!client) {
        throw new Error("Cliente Supabase não disponível");
      }

      var result = await client.auth.signInWithPassword({ email: email, password: password });
      if (result.error) {
        throw result.error;
      }

      var session = result.data.session;
      var user = result.data.user;

      if (!session) {
        throw new Error("Sessão não retornada");
      }

      saveTokens(session);

      await saveUserId(getUserIdFromUser(user));

      if (els.loginError) els.loginError.textContent = "";
      await initDashboard();
    } catch (err) {
      if (els.loginError) els.loginError.textContent = err.message || "Erro ao fazer login";
    }
  }

  // Logout
  async function handleLogout() {
    try {
      var client = window.MinutarioAPI.getClient();
      if (client) {
        await client.auth.signOut();
      }
    } catch (e) {
      // ignore
    }

    if (realtimeSubscription) {
      try {
        realtimeSubscription.unsubscribe();
      } catch (e) {
        // ignore
      }
      realtimeSubscription = null;
    }

    clearTokens();
    await window.MinutarioDB.deleteAllTemplates();

    allTemplates = [];
    filteredTemplates = [];
    userId = null;

    showLoginScreen();
  }

  // Templates
  async function loadTemplates() {
    if (!userId) {
      userId = await getStoredUserId();
    }

    try {
      var localTemplates = await window.MinutarioDB.getAllTemplates();
      allTemplates = localTemplates;
      filterAndRender();

      if (userId && window.MinutarioSync && window.MinutarioSync.syncTemplates) {
        window.MinutarioSync.syncTemplates(userId).then(function(result) {
          if (result.success) {
            return window.MinutarioDB.getAllTemplates();
          }
          return null;
        }).then(function(templates) {
          if (templates) {
            allTemplates = templates;
            filterAndRender();
          }
        }).catch(function(err) {
          console.error("Sync error:", err);
        });
      }
    } catch (err) {
      console.error("Load templates error:", err);
      showToast("Erro ao carregar templates");
    }
  }

  async function getAllTemplatesForExport() {
    if (!window.MinutarioDB || !window.MinutarioDB.getAllTemplates) {
      throw new Error("Banco local indisponível");
    }

    return await window.MinutarioDB.getAllTemplates();
  }

  async function getAllFoldersForCsv() {
    if (window.MinutarioDB && window.MinutarioDB.getAllFolders) {
      return await window.MinutarioDB.getAllFolders();
    }

    return [];
  }

  async function handleCsvExport() {
    setImportStatus("");

    try {
      if (!window.CsvSync || typeof window.CsvSync.exportCsv !== "function") {
        throw new Error("Módulo CSV indisponível");
      }

      var templates = await getAllTemplatesForExport();
      var folders = await getAllFoldersForCsv();

      if (!templates || templates.length === 0) {
        setImportStatus("Nenhum gatilho para exportar.", true);
        showToast("Nenhum gatilho para exportar.");
        return;
      }

      var csv = window.CsvSync.exportCsv(templates, folders);
      var filename = "text-expander-backup-" + getCurrentDateString() + ".csv";
      triggerCsvDownload(csv, filename);
      setImportStatus("CSV exportado com sucesso.");
      showToast("CSV exportado com sucesso.");
    } catch (error) {
      console.error("CSV export error:", error);
      setImportStatus(error.message || "Erro ao exportar CSV.", true);
      showToast("Erro ao exportar CSV.");
    }
  }

  async function saveImportedTemplates(templates) {
    if (!window.MinutarioDB) {
      throw new Error("Banco local indisponível");
    }

    var save = window.MinutarioDB.saveTemplate || window.MinutarioDB.putTemplate;
    if (typeof save !== "function") {
      throw new Error("API de salvamento local indisponível");
    }

    for (var i = 0; i < templates.length; i += 1) {
      await save.call(window.MinutarioDB, templates[i]);
    }
  }

  async function handleCsvImport(event) {
    var input = event && event.target ? event.target : els.importCsvInput;
    var file = input && input.files && input.files[0] ? input.files[0] : null;

    setImportStatus("");

    if (!file) {
      return;
    }

    try {
      if (!/\.csv$/i.test(file.name || "")) {
        throw new Error("Selecione um arquivo .csv");
      }

      if (!window.CsvSync || typeof window.CsvSync.parseCsv !== "function") {
        throw new Error("Módulo CSV indisponível");
      }

      var text = await readFileAsText(file);
      var parsed = window.CsvSync.parseCsv(text);

      if (!parsed.success) {
        throw new Error((parsed.errors || ["CSV inválido."]).join(" "));
      }

      var existingTemplates = await getAllTemplatesForExport();
      var folders = await getAllFoldersForCsv();
      var result = window.CsvSync.importCsv(parsed.data, existingTemplates, folders, {
        userId: userId || await getStoredUserId(),
      });

      if (!result.templates || result.templates.length === 0) {
        throw new Error("CSV não contém gatilhos válidos.");
      }

      await saveImportedTemplates(result.templates);
      await notifyTemplatesUpdated();
      await loadFolders();
      await loadTemplates();
      handleNewTemplate();

      var message =
        result.stats.created +
        " gatilhos importados, " +
        result.stats.updated +
        " atualizados.";
      setImportStatus(message);
      showToast(message);
    } catch (error) {
      console.error("CSV import error:", error);
      setImportStatus(error.message || "Erro ao importar CSV.", true);
      showToast("Erro ao importar CSV.");
    } finally {
      if (input) {
        input.value = "";
      }
    }
  }

  function filterAndRender() {
    var query = els.searchInput ? els.searchInput.value.trim().toLowerCase() : "";
    var candidates = allTemplates.filter(function(t) {
      var folderId = t.folder_id || t.folderId || null;
      return !activeFolderId || folderId === activeFolderId;
    });

    if (!query) {
      filteredTemplates = candidates.slice();
    } else {
      filteredTemplates = candidates.filter(function(t) {
        var nameMatch = t.name && t.name.toLowerCase().indexOf(query) !== -1;
        var shortcutMatch = t.shortcut && t.shortcut.toLowerCase().indexOf(query) !== -1;
        var contentMatch = t.plain_text && t.plain_text.toLowerCase().indexOf(query) !== -1;
        return nameMatch || shortcutMatch || contentMatch;
      });
    }

    renderTemplateList();
  }

  function renderTemplateList() {
    if (!els.templateList) return;
    els.templateList.innerHTML = "";

    if (filteredTemplates.length === 0) {
      els.templateList.classList.add("hidden");
      if (els.emptyState) els.emptyState.classList.remove("hidden");
      return;
    }

    els.templateList.classList.remove("hidden");
    if (els.emptyState) els.emptyState.classList.add("hidden");

    var fragment = document.createDocumentFragment();

    filteredTemplates.forEach(function(template, index) {
      var li = document.createElement("li");
      li.className = "template-item";
      li.dataset.id = template.id;
      li.dataset.index = String(index);

      var numberBadge = document.createElement("div");
      numberBadge.className = "template-number";
      numberBadge.textContent = String(index + 1);
      li.appendChild(numberBadge);

      var info = document.createElement("div");
      info.className = "template-info";

      var nameEl = document.createElement("div");
      nameEl.className = "template-name";
      nameEl.textContent = template.name || "Sem nome";
      info.appendChild(nameEl);

      var meta = document.createElement("div");
      meta.className = "template-meta";

      var shortcutEl = document.createElement("span");
      shortcutEl.className = "template-shortcut";
      shortcutEl.textContent = template.shortcut || "";
      meta.appendChild(shortcutEl);

      if (template.usage_count !== undefined && template.usage_count !== null) {
        var usageEl = document.createElement("span");
        usageEl.className = "template-usage";
        usageEl.textContent = template.usage_count + " uso" + (template.usage_count === 1 ? "" : "s");
        meta.appendChild(usageEl);
      }

      info.appendChild(meta);
      li.appendChild(info);

      li.addEventListener("click", function() {
        if (quill && els.editorForm) {
          loadTemplateIntoEditor(template);
        } else {
          copyTemplate(template);
        }
      });

      fragment.appendChild(li);
    });

    els.templateList.appendChild(fragment);
  }

  // Clipboard
  async function copyTemplate(template) {
    var name = template.name || "Template";
    var plainText = template.plain_text || "";
    var htmlContent = template.html_content || "";

    if (!plainText && !htmlContent && template.content) {
      htmlContent = template.content;
      plainText = stripHtml(template.content);
    }

    if (!plainText && htmlContent) {
      plainText = stripHtml(htmlContent);
    }

    var textToCopy = plainText || htmlContent || "";

    try {
      if (navigator.clipboard && navigator.clipboard.write && htmlContent) {
        var blobHtml = new Blob([htmlContent], { type: "text/html" });
        var blobText = new Blob([plainText || htmlContent], { type: "text/plain" });
        var item = new ClipboardItem({
          "text/html": blobHtml,
          "text/plain": blobText
        });
        await navigator.clipboard.write([item]);
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(textToCopy);
      } else {
        throw new Error("Clipboard não suportado");
      }

      showToast("'" + name + "' copiado! Cole com Ctrl+V");
    } catch (err) {
      console.error("Copy error:", err);
      showToast("Erro ao copiar template");
    }
  }

  function copyTemplateAtIndex(index) {
    if (index >= 0 && index < filteredTemplates.length) {
      copyTemplate(filteredTemplates[index]);
    }
  }

  // Search
  function handleSearchInput() {
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(function() {
      filterAndRender();
    }, 150);
  }

  function showShortcutError(message) {
    if (els.shortcutError) {
      els.shortcutError.textContent = message || "";
    }
  }

  function getTemplateById(id) {
    for (var i = 0; i < allTemplates.length; i++) {
      if (allTemplates[i].id === id) return allTemplates[i];
    }
    return null;
  }

  function getDuplicateShortcut(shortcut) {
    var normalized = shortcut.toLowerCase();
    for (var i = 0; i < allTemplates.length; i++) {
      var template = allTemplates[i];
      if (template.id !== currentTemplateId && (template.shortcut || "").toLowerCase() === normalized) {
        return template;
      }
    }
    return null;
  }

  // Editor logic
  function initEditor() {
    if (!els.quillEditor) return;
    quill = new Quill('#quill-editor', {
      theme: 'snow',
      modules: {
        toolbar: [
          [{ 'header': [1, 2, 3, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          ['clean']
        ]
      }
    });
  }

  function handleNewTemplate() {
    currentTemplateId = null;
    if (els.editorForm) els.editorForm.reset();
    if (quill && quill.setContents) quill.setContents([]);
    else if (quill && quill.root) quill.root.innerHTML = "";
    if (els.tplFolder) els.tplFolder.value = activeFolderId || "";
    if (els.deleteTemplateBtn) els.deleteTemplateBtn.style.display = 'none';
  }

  function loadTemplateIntoEditor(template) {
    currentTemplateId = template.id;
    if (els.tplName) els.tplName.value = template.name || "";
    if (els.tplShortcut) els.tplShortcut.value = template.shortcut || "";
    if (els.tplFolder) els.tplFolder.value = template.folder_id || template.folderId || "";
    if (quill) {
      quill.root.innerHTML = template.content || template.html_content || "";
    }
    if (els.deleteTemplateBtn) els.deleteTemplateBtn.style.display = 'inline-block';
  }

  async function handleSaveTemplate(event) {
    event.preventDefault();
    if (!quill) return;

    var shortcut = els.tplShortcut.value.trim().replace(/^\//, '').toLowerCase();
    var duplicate = getDuplicateShortcut(shortcut);
    if (duplicate) {
      showShortcutError('Atalho já em uso pelo template "' + (duplicate.name || "Sem nome") + '".');
      return;
    }
    showShortcutError("");

    var existing = currentTemplateId ? getTemplateById(currentTemplateId) : null;
    var folderValue = els.tplFolder ? els.tplFolder.value || null : null;
    var folderId = folderValue || (existing ? existing.folder_id || existing.folderId || null : null);
    var now = new Date();
    var nowIso = now.toISOString();
    var nowMs = now.getTime();

    var tpl = {
      id: currentTemplateId || crypto.randomUUID(),
      name: els.tplName.value.trim(),
      shortcut: shortcut,
      folder_id: folderId,
      folderId: folderId,
      content: quill.root.innerHTML,
      plain_text: quill.getText(),
      user_id: userId || null,
      updated_at: nowIso,
      updatedAt: nowMs
    };

    tpl.created_at = existing && existing.created_at ? existing.created_at : nowIso;
    tpl.createdAt = existing && existing.createdAt ? existing.createdAt : nowMs;

    try {
      if (window.MinutarioDB && window.MinutarioDB.saveTemplate) {
        await window.MinutarioDB.saveTemplate(tpl);
      } else if (window.MinutarioDB && window.MinutarioDB.putTemplate) {
        await window.MinutarioDB.putTemplate(tpl);
      } else {
        throw new Error("MinutarioDB save API not available");
      }
      currentTemplateId = tpl.id;

      if (userId && window.MinutarioAPI) {
        if (existing && window.MinutarioAPI.updateTemplate) {
          await window.MinutarioAPI.updateTemplate(tpl.id, tpl);
        } else if (!existing && window.MinutarioAPI.createTemplate) {
          await window.MinutarioAPI.createTemplate(tpl);
        }
      }

      showToast("Template salvo com sucesso!");

      // Sync immediately
      if (userId && window.MinutarioSync && window.MinutarioSync.syncTemplates) {
        await window.MinutarioSync.syncTemplates(userId);
      }
      await notifyTemplatesUpdated();
      await loadTemplates();
    } catch (err) {
      console.error(err);
      showToast("Erro ao salvar template");
    }
  }

  async function handleDeleteTemplate() {
    if (!currentTemplateId) return;
    if (!confirm("Tem certeza que deseja excluir este template?")) return;

    try {
      if (window.MinutarioDB && window.MinutarioDB.deleteTemplate) {
        await window.MinutarioDB.deleteTemplate(currentTemplateId);
      } else {
        throw new Error("MinutarioDB delete API not available");
      }

      if (userId && window.MinutarioAPI && window.MinutarioAPI.deleteTemplate) {
        await window.MinutarioAPI.deleteTemplate(currentTemplateId);
      }

      showToast("Template excluído!");
      handleNewTemplate();

      if (userId && window.MinutarioSync && window.MinutarioSync.syncTemplates) {
        await window.MinutarioSync.syncTemplates(userId);
      }
      await notifyTemplatesUpdated();
      await loadTemplates();
    } catch (err) {
      console.error(err);
      showToast("Erro ao excluir template");
    }
  }

  async function handleNewFolder() {
    var name = prompt("Nome da pasta:");
    if (!name) return;

    name = name.trim();
    if (!name) return;

    var now = new Date();
    var folder = {
      id: crypto.randomUUID(),
      user_id: userId || null,
      name: name,
      order: allFolders.length,
      created_at: now.toISOString(),
      updated_at: now.toISOString(),
    };

    try {
      if (window.MinutarioDB && window.MinutarioDB.saveFolder) {
        await window.MinutarioDB.saveFolder(folder);
      } else if (window.MinutarioDB && window.MinutarioDB.putFolder) {
        await window.MinutarioDB.putFolder(folder);
      } else {
        throw new Error("MinutarioDB folder save API not available");
      }

      if (userId && window.MinutarioAPI && window.MinutarioAPI.createFolder) {
        await window.MinutarioAPI.createFolder(folder);
      }

      await loadFolders();
      setActiveFolder(folder.id);
      if (els.tplFolder) els.tplFolder.value = folder.id;
      showToast("Pasta criada com sucesso!");
    } catch (err) {
      console.error(err);
      showToast("Erro ao criar pasta");
    }
  }

  async function handleDeleteFolder() {
    if (!activeFolderId) return;

    var linkedTemplates = allTemplates.filter(function(template) {
      return (template.folder_id || template.folderId || null) === activeFolderId;
    });

    if (linkedTemplates.length > 0) {
      showToast("Remova ou mova os templates da pasta antes de excluí-la");
      return;
    }

    if (!confirm("Tem certeza que deseja excluir esta pasta?")) return;

    try {
      if (window.MinutarioDB && window.MinutarioDB.deleteFolder) {
        await window.MinutarioDB.deleteFolder(activeFolderId);
      } else {
        throw new Error("MinutarioDB folder delete API not available");
      }

      if (userId && window.MinutarioAPI && window.MinutarioAPI.deleteFolder) {
        await window.MinutarioAPI.deleteFolder(activeFolderId);
      }

      activeFolderId = null;
      await loadFolders();
      filterAndRender();
      if (els.tplFolder) els.tplFolder.value = "";
      showToast("Pasta excluída!");
    } catch (err) {
      console.error(err);
      showToast("Erro ao excluir pasta");
    }
  }

  // Keyboard shortcuts
  function handleKeydown(event) {
    var searchFocused = document.activeElement === els.searchInput;

    // Ctrl+1 to Ctrl+9
    if (event.ctrlKey && !event.altKey && !event.metaKey) {
      var keyNum = parseInt(event.key, 10);
      if (keyNum >= 1 && keyNum <= 9) {
        event.preventDefault();
        copyTemplateAtIndex(keyNum - 1);
        return;
      }
    }

    // Enter on search copies first result
    if (event.key === "Enter" && searchFocused && filteredTemplates.length > 0) {
      event.preventDefault();
      copyTemplate(filteredTemplates[0]);
      return;
    }

    // Escape clears search
    if (event.key === "Escape") {
      if (!els.searchInput) return;
      if (els.searchInput.value !== "") {
        els.searchInput.value = "";
        filterAndRender();
      }
      els.searchInput.blur();
    }
  }

  // Realtime
  function subscribeRealtime() {
    if (!userId || !window.MinutarioAPI.subscribeToTemplates) {
      return;
    }

    realtimeSubscription = window.MinutarioAPI.subscribeToTemplates(userId, function(payload) {
      loadTemplates();
    });
  }

  // Init dashboard after login
  async function initDashboard() {
    showDashboardScreen();
    updateSyncBadge("idle");

    if (window.MinutarioSync && window.MinutarioSync.onSyncStateChange) {
      window.MinutarioSync.onSyncStateChange(function(state) {
        updateSyncBadge(state);
      });
    }

    await loadFolders();
    await loadTemplates();

    if (userId) {
      subscribeRealtime();
    }

    initEditor();
    handleNewTemplate();
  }

  // App init
  async function init() {
    var tokens = getStoredTokens();

    if (tokens.accessToken && tokens.refreshToken) {
      try {
        var client = window.MinutarioAPI.getClient();
        if (client) {
          await client.auth.setSession({
            access_token: tokens.accessToken,
            refresh_token: tokens.refreshToken
          });

          var userResult = await client.auth.getUser();
          if (userResult.error) {
            throw userResult.error;
          }

          var user = userResult.data.user;
          await saveUserId(getUserIdFromUser(user));

          await initDashboard();
          return;
        }
      } catch (err) {
        console.error("Auth restore failed:", err);
        clearTokens();
      }
    }

    if (els.loginScreen) {
      showLoginScreen();
    } else {
      // dashboard.html não tem login screen - carrega diretamente
      await initDashboard();
    }
  }

  // Events
  function bindEvents() {
    if (els.loginForm) els.loginForm.addEventListener("submit", handleLogin);
    if (els.logoutBtn) els.logoutBtn.addEventListener("click", handleLogout);
    if (els.searchInput) els.searchInput.addEventListener("input", handleSearchInput);
    if (els.newTemplateBtn) els.newTemplateBtn.addEventListener("click", handleNewTemplate);
    if (els.importCsvInput) els.importCsvInput.addEventListener("change", handleCsvImport);
    if (els.exportCsvBtn) els.exportCsvBtn.addEventListener("click", handleCsvExport);
    if (els.editorForm) els.editorForm.addEventListener("submit", handleSaveTemplate);
    if (els.deleteTemplateBtn) els.deleteTemplateBtn.addEventListener("click", handleDeleteTemplate);
    if (els.newFolderBtn) els.newFolderBtn.addEventListener("click", handleNewFolder);
    if (els.deleteFolderBtn) els.deleteFolderBtn.addEventListener("click", handleDeleteFolder);
    document.addEventListener("keydown", handleKeydown);
  }

  cacheElements();
  bindEvents();
  init();

  // Service Worker
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(console.error);
  }
})();
