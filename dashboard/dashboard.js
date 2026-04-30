(function() {
  "use strict";

  // State
  var allTemplates = [];
  var filteredTemplates = [];
  var debounceTimer = null;
  var realtimeSubscription = null;
  var orgId = null;

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
    els.searchInput = document.getElementById("search-input");
    els.templateList = document.getElementById("template-list");
    els.emptyState = document.getElementById("empty-state");
    els.syncBadge = document.getElementById("sync-badge");
    els.toast = document.getElementById("toast");
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
    var item = document.createElement("div");
    item.className = "toast-item";
    item.textContent = message;
    els.toast.appendChild(item);
    window.setTimeout(function() {
      item.remove();
    }, 2500);
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
    localStorage.removeItem("minutario_org_id");
  }

  // Screen management
  function showLoginScreen() {
    els.loginScreen.classList.remove("hidden");
    els.dashboardScreen.classList.add("hidden");
  }

  function showDashboardScreen() {
    els.loginScreen.classList.add("hidden");
    els.dashboardScreen.classList.remove("hidden");
  }

  // Sync badge
  function updateSyncBadge(state) {
    var badge = els.syncBadge;
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

      var userOrgId = user && user.user_metadata ? user.user_metadata.org_id : null;
      if (userOrgId) {
        orgId = userOrgId;
        localStorage.setItem("minutario_org_id", orgId);
      }

      els.loginError.textContent = "";
      await initDashboard();
    } catch (err) {
      els.loginError.textContent = err.message || "Erro ao fazer login";
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
    orgId = null;

    showLoginScreen();
  }

  // Templates
  async function loadTemplates() {
    if (!orgId) {
      orgId = localStorage.getItem("minutario_org_id");
    }

    try {
      var localTemplates = await window.MinutarioDB.getAllTemplates();
      allTemplates = localTemplates;
      filterAndRender();

      if (orgId && window.MinutarioSync && window.MinutarioSync.syncTemplates) {
        window.MinutarioSync.syncTemplates(orgId).then(function(result) {
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

  function filterAndRender() {
    var query = els.searchInput.value.trim().toLowerCase();

    if (!query) {
      filteredTemplates = allTemplates.slice();
    } else {
      filteredTemplates = allTemplates.filter(function(t) {
        var nameMatch = t.name && t.name.toLowerCase().indexOf(query) !== -1;
        var shortcutMatch = t.shortcut && t.shortcut.toLowerCase().indexOf(query) !== -1;
        var contentMatch = t.plain_text && t.plain_text.toLowerCase().indexOf(query) !== -1;
        return nameMatch || shortcutMatch || contentMatch;
      });
    }

    renderTemplateList();
  }

  function renderTemplateList() {
    els.templateList.innerHTML = "";

    if (filteredTemplates.length === 0) {
      els.templateList.classList.add("hidden");
      els.emptyState.classList.remove("hidden");
      return;
    }

    els.templateList.classList.remove("hidden");
    els.emptyState.classList.add("hidden");

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
        copyTemplate(template);
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
      if (els.searchInput.value !== "") {
        els.searchInput.value = "";
        filterAndRender();
      }
      els.searchInput.blur();
    }
  }

  // Realtime
  function subscribeRealtime() {
    if (!orgId || !window.MinutarioAPI.subscribeToTemplates) {
      return;
    }

    realtimeSubscription = window.MinutarioAPI.subscribeToTemplates(orgId, function(payload) {
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

    await loadTemplates();

    if (orgId) {
      subscribeRealtime();
    }
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
          var userOrgId = user && user.user_metadata ? user.user_metadata.org_id : null;
          if (userOrgId) {
            orgId = userOrgId;
            localStorage.setItem("minutario_org_id", orgId);
          }

          await initDashboard();
          return;
        }
      } catch (err) {
        console.error("Auth restore failed:", err);
        clearTokens();
      }
    }

    showLoginScreen();
  }

  // Events
  function bindEvents() {
    els.loginForm.addEventListener("submit", handleLogin);
    els.logoutBtn.addEventListener("click", handleLogout);
    els.searchInput.addEventListener("input", handleSearchInput);
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
