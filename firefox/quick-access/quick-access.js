(function () {
  "use strict";

  var state = {
    templates: [],
    folders: [],
    mode: "all",
    folderId: null,
    query: "",
    selectedTemplateId: null,
    syncLabel: "Local",
  };

  var els = {};

  function cacheElements() {
    els.searchInput = document.getElementById("template-search");
    els.resultList = document.getElementById("result-list");
    els.resultsEmpty = document.getElementById("results-empty");
    els.previewEmpty = document.getElementById("preview-empty");
    els.previewContent = document.getElementById("preview-content");
    els.copyButton = document.getElementById("copy-template");
    els.openDashboardButton = document.getElementById("open-dashboard");
    els.folderChipList = document.getElementById("folder-chip-list");
    els.resultCount = document.getElementById("result-count");
    els.syncStatus = document.getElementById("sync-status");
    els.toast = document.getElementById("toast");
  }

  function normalizeText(value) {
    return String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .trim();
  }

  function stripCommandPrefix(query) {
    return query.charAt(0) === "/" ? query.slice(1) : query;
  }

  function scoreMatch(template, query) {
    var normalizedQuery = normalizeText(stripCommandPrefix(query));
    if (!normalizedQuery) return 0;

    var name = normalizeText(template.name);
    var shortcut = normalizeText(template.shortcut);
    var plainText = normalizeText(template.plain_text || template.content);

    if (shortcut === normalizedQuery || ("/" + shortcut) === query.toLowerCase()) {
      return 400;
    }
    if (name.indexOf(normalizedQuery) !== -1) return 300 - name.indexOf(normalizedQuery);
    if (shortcut.indexOf(normalizedQuery) !== -1) return 260 - shortcut.indexOf(normalizedQuery);
    if (isFuzzyMatch(name, normalizedQuery)) return 180;
    if (isFuzzyMatch(shortcut, normalizedQuery)) return 170;
    if (plainText.indexOf(normalizedQuery) !== -1) return 120 - Math.min(100, plainText.indexOf(normalizedQuery));

    return -1;
  }

  function isFuzzyMatch(haystack, needle) {
    if (!needle) return true;

    var needleIndex = 0;
    for (var i = 0; i < haystack.length; i += 1) {
      if (haystack.charAt(i) === needle.charAt(needleIndex)) {
        needleIndex += 1;
        if (needleIndex === needle.length) {
          return true;
        }
      }
    }

    return false;
  }

  function getFilteredTemplates() {
    var query = state.query;
    var filtered = state.templates.filter(function (template) {
      var templateFolderId = template.folder_id || template.folderId || null;
      if (state.folderId && templateFolderId !== state.folderId) {
        return false;
      }

      if (!query) {
        return true;
      }

      return scoreMatch(template, query) >= 0;
    });

    filtered.sort(function (a, b) {
      var scoreDiff = scoreMatch(b, query) - scoreMatch(a, query);
      if (scoreDiff !== 0) {
        return scoreDiff;
      }

      return String(a.name || "").localeCompare(String(b.name || ""));
    });

    return filtered;
  }

  function setFolderFilter(folderId) {
    state.folderId = folderId || null;
    ensureSelectedTemplate();
    render();
  }

  function ensureSelectedTemplate() {
    var filtered = getFilteredTemplates();
    var hasSelected = filtered.some(function (template) {
      return template.id === state.selectedTemplateId;
    });

    if (!hasSelected) {
      state.selectedTemplateId = filtered.length > 0 ? filtered[0].id : null;
    }
  }

  function getSelectedTemplate() {
    for (var i = 0; i < state.templates.length; i += 1) {
      if (state.templates[i].id === state.selectedTemplateId) {
        return state.templates[i];
      }
    }
    return null;
  }

  function renderFolderChips() {
    if (!els.folderChipList) return;

    els.folderChipList.innerHTML = "";

    var allChip = document.createElement("button");
    allChip.type = "button";
    allChip.className = "folder-chip" + (!state.folderId ? " active" : "");
    allChip.textContent = "Todas as pastas";
    allChip.addEventListener("click", function () {
      setFolderFilter(null);
    });
    els.folderChipList.appendChild(allChip);

    state.folders.forEach(function (folder) {
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "folder-chip" + (state.folderId === folder.id ? " active" : "");
      chip.textContent = folder.name || "Sem nome";
      chip.addEventListener("click", function () {
        setFolderFilter(state.folderId === folder.id ? null : folder.id);
      });
      els.folderChipList.appendChild(chip);
    });
  }

  function renderResults() {
    if (!els.resultList) return;

    var filtered = getFilteredTemplates();
    els.resultList.innerHTML = "";

    if (els.resultCount) {
      els.resultCount.textContent = filtered.length + (filtered.length === 1 ? " minuta" : " minutas");
    }
    if (els.syncStatus) {
      els.syncStatus.textContent = state.syncLabel;
    }

    if (filtered.length === 0) {
      if (els.resultsEmpty) els.resultsEmpty.classList.remove("hidden");
      return;
    }

    if (els.resultsEmpty) els.resultsEmpty.classList.add("hidden");

    filtered.forEach(function (template) {
      var item = document.createElement("li");
      item.className = "result-item" + (template.id === state.selectedTemplateId ? " active" : "");
      item.tabIndex = 0;
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", template.id === state.selectedTemplateId ? "true" : "false");
      item.dataset.id = template.id;

      var title = document.createElement("div");
      title.className = "result-title";
      title.textContent = template.name || "Sem nome";
      item.appendChild(title);

      var subtitle = document.createElement("div");
      subtitle.className = "result-subtitle";
      subtitle.textContent = "/" + (template.shortcut || "");
      item.appendChild(subtitle);

      item.addEventListener("click", function () {
        state.selectedTemplateId = template.id;
        render();
      });

      item.addEventListener("dblclick", function () {
        state.selectedTemplateId = template.id;
        render();
        void copySelectedTemplate();
      });

      item.addEventListener("keydown", function (event) {
        if (event.key === "Enter") {
          event.preventDefault();
          state.selectedTemplateId = template.id;
          render();
          void copySelectedTemplate();
        }
      });

      els.resultList.appendChild(item);
    });
  }

  function renderPreview() {
    var template = getSelectedTemplate();

    if (!template) {
      if (els.previewEmpty) els.previewEmpty.classList.remove("hidden");
      if (els.previewContent) {
        els.previewContent.classList.add("hidden");
        els.previewContent.innerHTML = "";
      }
      if (els.copyButton) {
        els.copyButton.disabled = true;
        els.copyButton.setAttribute("aria-disabled", "true");
      }
      return;
    }

    if (els.previewEmpty) els.previewEmpty.classList.add("hidden");
    if (els.previewContent) {
      els.previewContent.classList.remove("hidden");
      els.previewContent.innerHTML = template.content || "";
    }
    if (els.copyButton) {
      els.copyButton.disabled = false;
      els.copyButton.setAttribute("aria-disabled", "false");
    }
  }

  function render() {
    renderFolderChips();
    renderResults();
    renderPreview();
  }

  async function requestTemplates() {
    var response = await chrome.runtime.sendMessage({
      type: "GET_TEMPLATES",
      payload: {},
    });
    if (!response || !response.ok || !Array.isArray(response.data)) {
      throw new Error(response && response.error ? response.error : "Falha ao carregar minutas");
    }
    return response.data;
  }

  async function requestFolders() {
    var response = await chrome.runtime.sendMessage({ type: "GET_FOLDERS" });
    if (!response || !response.ok || !Array.isArray(response.data)) {
      throw new Error(response && response.error ? response.error : "Falha ao carregar pastas");
    }
    return response.data;
  }

  function showToast(message, tone) {
    if (!els.toast) return;

    var toast = document.createElement("div");
    toast.className = "toast" + (tone ? " " + tone : "");
    toast.textContent = message;
    els.toast.appendChild(toast);

    window.setTimeout(function () {
      toast.remove();
    }, 2200);
  }

  async function writeRichClipboard(html, plainText) {
    if (!navigator.clipboard) {
      throw new Error("Clipboard API indisponível");
    }

    if (typeof navigator.clipboard.write === "function" && typeof ClipboardItem !== "undefined") {
      var htmlBlob = new Blob([html], { type: "text/html" });
      var textBlob = new Blob([plainText], { type: "text/plain" });
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": htmlBlob,
          "text/plain": textBlob,
        }),
      ]);
      return "rich";
    }

    if (typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(plainText);
      return "plain";
    }

    throw new Error("Método de cópia não suportado");
  }

  function fallbackCopy(plainText) {
    var textarea = document.createElement("textarea");
    textarea.value = plainText;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    textarea.style.pointerEvents = "none";
    document.body.appendChild(textarea);
    textarea.select();

    try {
      return document.execCommand("copy");
    } finally {
      textarea.remove();
    }
  }

  async function copySelectedTemplate() {
    var template = getSelectedTemplate();
    if (!template) {
      return;
    }

    var plainText = stripHtml(template.content || "");
    try {
      var mode = await writeRichClipboard(template.content || "", plainText);
      showToast(mode === "rich" ? "Minuta copiada com formatação." : "Minuta copiada em texto simples.", "success");
    } catch (error) {
      var copied = fallbackCopy(plainText);
      if (copied) {
        showToast("Permissão rica negada. Minuta copiada em texto simples.", "success");
      } else {
        showToast("Não foi possível copiar a minuta. Verifique a permissão da área de transferência.", "error");
        return;
      }
    }
  }

  function stripHtml(html) {
    var container = document.createElement("div");
    container.innerHTML = html || "";
    return container.textContent || container.innerText || "";
  }

  function selectNextResult(step) {
    var filtered = getFilteredTemplates();
    if (filtered.length === 0) return;

    var currentIndex = filtered.findIndex(function (template) {
      return template.id === state.selectedTemplateId;
    });

    if (currentIndex === -1) {
      state.selectedTemplateId = filtered[0].id;
    } else {
      var nextIndex = currentIndex + step;
      if (nextIndex < 0) nextIndex = filtered.length - 1;
      if (nextIndex >= filtered.length) nextIndex = 0;
      state.selectedTemplateId = filtered[nextIndex].id;
    }

    render();
  }

  async function hydrateData(options) {
    options = options || {};
    state.syncLabel = options.syncing ? "Sincronizando..." : state.syncLabel;
    render();

    var results = await Promise.all([
      requestTemplates(),
      requestFolders(),
    ]);

    state.templates = results[0];
    state.folders = results[1];
    ensureSelectedTemplate();
    render();
  }

  async function syncInBackground() {
    try {
      state.syncLabel = "Sincronizando...";
      render();

      var response = await chrome.runtime.sendMessage({ type: "FORCE_SYNC" });
      if (response && response.ok && response.data && response.data.updated) {
        await hydrateData();
        state.syncLabel = "Atualizado";
        render();
        return;
      }

      state.syncLabel = response && response.data && response.data.error ? "Erro: " + response.data.error : "Erro ao sincronizar";
      render();
    } catch (error) {
      state.syncLabel = "Erro ao sincronizar";
      render();
    }
  }

  function openDashboard() {
    chrome.tabs.create({ url: chrome.runtime.getURL("dashboard/dashboard.html") });
  }

  function bindEvents() {
    if (els.searchInput) {
      els.searchInput.addEventListener("input", function (event) {
        state.query = event.target.value || "";
        ensureSelectedTemplate();
        render();
      });

      els.searchInput.addEventListener("keydown", function (event) {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          selectNextResult(1);
          return;
        }

        if (event.key === "ArrowUp") {
          event.preventDefault();
          selectNextResult(-1);
          return;
        }

        if (event.key === "Enter") {
          event.preventDefault();
          void copySelectedTemplate();
        }
      });
    }

    if (els.copyButton) {
      els.copyButton.addEventListener("click", function () {
        void copySelectedTemplate();
      });
    }

    if (els.openDashboardButton) {
      els.openDashboardButton.addEventListener("click", openDashboard);
    }

  }

  async function init() {
    cacheElements();
    bindEvents();

    try {
      await hydrateData();
      if (els.searchInput) {
        els.searchInput.focus();
      }
      void syncInBackground();
    } catch (error) {
      showToast(error.message || "Erro ao carregar minutas.", "error");
    }
  }

  init();
})();
