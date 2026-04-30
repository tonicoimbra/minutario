document.addEventListener("DOMContentLoaded", function () {
  var loginForm = document.getElementById("login-form");
  var openDashboardBtn = document.getElementById("open-dashboard");
  var forceSyncBtn = document.getElementById("force-sync");
  var logoutBtn = document.getElementById("logout");

  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  if (openDashboardBtn) {
    openDashboardBtn.addEventListener("click", openDashboard);
  }

  if (forceSyncBtn) {
    forceSyncBtn.addEventListener("click", forceSync);
  }

  if (logoutBtn) {
    logoutBtn.addEventListener("click", handleLogout);
  }

  checkAuth();
});

function getStoredTokens() {
  return {
    accessToken: localStorage.getItem("minutario_access_token"),
    refreshToken: localStorage.getItem("minutario_refresh_token"),
  };
}

function saveTokens(session) {
  localStorage.setItem("minutario_access_token", session.access_token);
  localStorage.setItem("minutario_refresh_token", session.refresh_token);
}

function clearTokens() {
  localStorage.removeItem("minutario_access_token");
  localStorage.removeItem("minutario_refresh_token");
}

function showLogin() {
  var loginSection = document.getElementById("login-section");
  var dashboardSection = document.getElementById("dashboard-section");
  if (loginSection) loginSection.classList.remove("hidden");
  if (dashboardSection) dashboardSection.classList.add("hidden");
}

function showDashboard(user) {
  var loginSection = document.getElementById("login-section");
  var dashboardSection = document.getElementById("dashboard-section");
  var userEmailEl = document.getElementById("user-email");
  var recentList = document.getElementById("recent-list");

  if (loginSection) loginSection.classList.add("hidden");
  if (dashboardSection) dashboardSection.classList.remove("hidden");

  if (userEmailEl) {
    userEmailEl.textContent = user && user.email ? user.email : "Usuário";
  }

  if (recentList) {
    loadRecentTemplates(recentList);
  }

  updateSyncStatus();
}

async function checkAuth() {
  var tokens = getStoredTokens();

  if (tokens.accessToken) {
    try {
      var client = window.MinutarioAPI.getClient();
      if (client) {
        await client.auth.setSession({
          access_token: tokens.accessToken,
          refresh_token: tokens.refreshToken,
        });

        var userResult = await client.auth.getUser();
        if (!userResult.error && userResult.data.user) {
          showDashboard(userResult.data.user);
          return;
        }
      }
    } catch (err) {
      console.error("Auth restore failed:", err);
    }

    clearTokens();
  }

  showLogin();
}

async function handleLogin(event) {
  event.preventDefault();

  var email = document.getElementById("login-email").value.trim();
  var password = document.getElementById("login-password").value;
  var errorEl = document.getElementById("login-error");

  try {
    var client = window.MinutarioAPI.getClient();
    if (!client) {
      throw new Error("Cliente Supabase não disponível");
    }

    var result = await client.auth.signInWithPassword({
      email: email,
      password: password,
    });
    if (result.error) {
      throw result.error;
    }

    var session = result.data.session;
    var user = result.data.user;

    if (!session) {
      throw new Error("Sessão não retornada");
    }

    saveTokens(session);

    var orgId = user && user.user_metadata ? user.user_metadata.org_id : null;
    if (orgId) {
      await chrome.storage.local.set({ minutario_org_id: orgId });
    }

    if (errorEl) errorEl.textContent = "";
    showDashboard(user);
  } catch (err) {
    if (errorEl) errorEl.textContent = err.message || "Erro ao fazer login";
  }
}

async function handleLogout() {
  try {
    var client = window.MinutarioAPI.getClient();
    if (client) {
      await client.auth.signOut();
    }
  } catch (e) {
    // ignore
  }

  clearTokens();
  await chrome.storage.local.remove("minutario_org_id");
  showLogin();
}

function openDashboard() {
  var url = chrome.runtime.getURL("dashboard/index.html");
  chrome.tabs.create({ url: url });
}

async function forceSync() {
  var statusEl = document.getElementById("sync-status");
  if (statusEl) statusEl.textContent = "Sincronizando...";

  try {
    var response = await chrome.runtime.sendMessage({ type: "FORCE_SYNC" });
    if (response.ok && response.data && response.data.updated) {
      if (statusEl)
        statusEl.textContent =
          "Sincronizado (" + (response.data.count || 0) + " templates)";
    } else if (response.ok) {
      if (statusEl) statusEl.textContent = "Sem alterações";
    } else {
      if (statusEl)
        statusEl.textContent = "Erro: " + (response.error || "desconhecido");
    }
  } catch (err) {
    if (statusEl) statusEl.textContent = "Erro na sincronização";
  }
}

async function updateSyncStatus() {
  try {
    var response = await chrome.runtime.sendMessage({ type: "GET_SYNC_STATE" });
    if (response.ok && response.data) {
      var state = response.data.state;
      var statusEl = document.getElementById("sync-status");
      var stateMap = {
        idle: "Pronto",
        syncing: "Sincronizando...",
        updated: "Atualizado",
        offline: "Offline",
        error: "Erro",
      };
      if (statusEl) statusEl.textContent = stateMap[state] || state;
    }
  } catch (err) {
    // ignore
  }
}

// Recent templates (existing functionality)
async function loadRecentTemplates(container) {
  var localData = await chrome.storage.local.get("recent");
  var recent = Array.isArray(localData.recent)
    ? localData.recent.slice(0, 3)
    : [];

  if (recent.length === 0) {
    renderEmptyState(container);
    return;
  }

  var templates = await Promise.all(
    recent.map(async function (id) {
      var key = "tpl_" + id;
      var syncData = await chrome.storage.sync.get(key);
      return { id: id, template: syncData[key] };
    })
  );

  var validTemplates = templates.filter(function (item) {
    return item.template && item.template.content;
  });

  if (validTemplates.length === 0) {
    renderEmptyState(container);
    return;
  }

  container.innerHTML = "";

  validTemplates.forEach(function (item) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "recent-item";
    button.dataset.templateId = item.id;

    var name = document.createElement("span");
    name.className = "recent-name";
    name.textContent = item.template.name || "Sem nome";

    var shortcut = document.createElement("span");
    shortcut.className = "recent-shortcut";
    shortcut.textContent = "/" + (item.template.shortcut || "");

    button.append(name, shortcut);

    button.addEventListener("click", async function () {
      await copyTemplateById(item.id, button, item.template);
    });

    container.appendChild(button);
  });
}

async function copyTemplateById(id, button, initialTemplate) {
  var key = "tpl_" + id;
  var syncData = await chrome.storage.sync.get(key);
  var template = syncData[key] || initialTemplate;

  if (!template || !template.content) {
    return;
  }

  var plain = stripHtml(template.content);

  await navigator.clipboard.write([
    new ClipboardItem({
      "text/html": new Blob([template.content], { type: "text/html" }),
      "text/plain": new Blob([plain], { type: "text/plain" }),
    }),
  ]);

  var originalMarkup = button.innerHTML;
  button.textContent = "Copiado!";

  window.setTimeout(function () {
    button.innerHTML = originalMarkup;
  }, 1500);
}

function stripHtml(html) {
  var parser = document.createElement("div");
  parser.innerHTML = html;
  return (parser.textContent || parser.innerText || "").trim();
}

function renderEmptyState(container) {
  container.innerHTML = "";
  var message = document.createElement("p");
  message.className = "empty-state";
  message.textContent = "Nenhum template usado ainda.";
  container.appendChild(message);
}
