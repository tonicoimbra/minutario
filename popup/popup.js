document.addEventListener("DOMContentLoaded", function () {
  var loginForm = document.getElementById("login-form");
  var openQuickAccessBtn = document.getElementById("open-quick-access");
  var openDashboardBtn = document.getElementById("open-dashboard");
  var forceSyncBtn = document.getElementById("force-sync");
  var logoutBtn = document.getElementById("logout");
  var togglePasswordFormBtn = document.getElementById("toggle-password-form");
  var passwordForm = document.getElementById("password-form");
  var cancelPasswordBtn = document.getElementById("cancel-password-btn");
  var forgotPasswordBtn = document.getElementById("forgot-password");

  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  if (openQuickAccessBtn) {
    openQuickAccessBtn.addEventListener("click", openQuickAccess);
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

  if (togglePasswordFormBtn) {
    togglePasswordFormBtn.addEventListener("click", togglePasswordForm);
  }

  if (passwordForm) {
    passwordForm.addEventListener("submit", handleChangePassword);
  }

  if (cancelPasswordBtn) {
    cancelPasswordBtn.addEventListener("click", function () {
      hidePasswordForm();
      setAccountStatus("");
    });
  }

  if (forgotPasswordBtn) {
    forgotPasswordBtn.addEventListener("click", handleForgotPassword);
  }

  setPopupVersion();
  checkAuth();
});

function getExtensionApi() {
  if (typeof browser !== "undefined") return browser;
  if (typeof chrome !== "undefined") return chrome;
  return null;
}

function setPopupVersion() {
  var versionEl = document.getElementById("app-version");
  if (!versionEl) return;

  try {
    var extensionApi = getExtensionApi();
    var manifest = extensionApi && extensionApi.runtime && extensionApi.runtime.getManifest
      ? extensionApi.runtime.getManifest()
      : null;
    var version = manifest && manifest.version ? String(manifest.version) : null;
    versionEl.textContent = version ? "v" + version : "v-";
  } catch (err) {
    versionEl.textContent = "v-";
  }
}

function getStoredTokens() {
  return {
    accessToken: localStorage.getItem("minutario_access_token"),
    refreshToken: localStorage.getItem("minutario_refresh_token"),
  };
}

async function saveTokens(session) {
  localStorage.setItem("minutario_access_token", session.access_token);
  localStorage.setItem("minutario_refresh_token", session.refresh_token);
  if (window.MinutarioAPI && window.MinutarioAPI.saveAuthSession) {
    await window.MinutarioAPI.saveAuthSession(session);
  }
}

async function clearTokens() {
  localStorage.removeItem("minutario_access_token");
  localStorage.removeItem("minutario_refresh_token");
  if (window.MinutarioAPI && window.MinutarioAPI.clearAuthSession) {
    await window.MinutarioAPI.clearAuthSession();
  }
}

function showLogin() {
  var loginSection = document.getElementById("login-section");
  var dashboardSection = document.getElementById("dashboard-section");
  if (loginSection) loginSection.classList.remove("hidden");
  if (dashboardSection) dashboardSection.classList.add("hidden");
  hidePasswordForm();
  setAccountStatus("");
}

function showDashboard(user) {
  var loginSection = document.getElementById("login-section");
  var dashboardSection = document.getElementById("dashboard-section");
  var userEmailEl = document.getElementById("user-email");

  if (loginSection) loginSection.classList.add("hidden");
  if (dashboardSection) dashboardSection.classList.remove("hidden");

  if (userEmailEl) {
    userEmailEl.textContent = user && user.email ? user.email : "Usuário";
  }

  updateSyncStatus();
}

function setAccountStatus(message, isError) {
  var statusEl = document.getElementById("account-status");
  if (!statusEl) return;
  statusEl.textContent = message || "";
  statusEl.style.color = isError ? "#dc2626" : "";
}

function hidePasswordForm() {
  var form = document.getElementById("password-form");
  var newPassword = document.getElementById("new-password");
  var confirmPassword = document.getElementById("confirm-password");
  if (form) form.classList.add("hidden");
  if (newPassword) newPassword.value = "";
  if (confirmPassword) confirmPassword.value = "";
}

function togglePasswordForm() {
  var form = document.getElementById("password-form");
  if (!form) return;
  var willShow = form.classList.contains("hidden");
  form.classList.toggle("hidden", !willShow);
  if (!willShow) {
    hidePasswordForm();
  }
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

    await clearTokens();
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
    if (result.error) throw result.error;

    var session = result.data.session;
    var user = result.data.user;

    if (!session) {
      throw new Error("Sessão não retornada");
    }

    await saveTokens(session);

    var userId = user && user.id ? user.id : null;
    if (userId) {
      var extensionApi = getExtensionApi();
      var previous = null;
      if (extensionApi && extensionApi.storage && extensionApi.storage.local) {
        var stored = await extensionApi.storage.local.get("minutario_user_id");
        previous = stored && stored.minutario_user_id ? stored.minutario_user_id : null;
      }

      if (window.MinutarioSync && window.MinutarioSync.prepareUserContext) {
        var switched = await window.MinutarioSync.prepareUserContext(userId, previous);
        if (window.MinutarioSync.syncTemplates) {
          var syncResult = await window.MinutarioSync.syncTemplates(userId, {
            forceFullPull: true,
            skipUserContext: switched,
          });
          if (!syncResult || !syncResult.success) {
            throw new Error(syncResult && syncResult.error ? syncResult.error : "Falha ao sincronizar após login");
          }
        }
      }

      if (extensionApi && extensionApi.storage && extensionApi.storage.local) {
        await extensionApi.storage.local.set({ minutario_user_id: userId });
      }
    }

    if (errorEl) {
      errorEl.style.color = "";
      errorEl.textContent = "";
    }
    showDashboard(user);
  } catch (err) {
    if (errorEl) {
      errorEl.style.color = "#dc2626";
      var message = err && err.message ? String(err.message) : "Erro ao fazer login";
      if (/invalid login credentials/i.test(message)) {
        message = "Credenciais inválidas. Confirme com o administrador.";
      }
      errorEl.textContent = message;
    }
  }
}

async function handleForgotPassword() {
  var emailEl = document.getElementById("login-email");
  var errorEl = document.getElementById("login-error");
  var email = emailEl ? emailEl.value.trim() : "";

  if (!email) {
    if (errorEl) {
      errorEl.style.color = "#dc2626";
      errorEl.textContent = "Informe seu email para recuperar a senha.";
    }
    return;
  }

  try {
    var client = window.MinutarioAPI.getClient();
    if (!client) {
      throw new Error("Cliente Supabase não disponível");
    }

    var config = window.MinutarioConfig || {};
    var extensionApi = getExtensionApi();
    var fallbackRedirect =
      extensionApi && extensionApi.runtime && extensionApi.runtime.getURL
        ? extensionApi.runtime.getURL("password-reset/password-reset.html")
        : "";
    var redirectTo = config.PASSWORD_RESET_REDIRECT_URL || fallbackRedirect;

    var result = await client.auth.resetPasswordForEmail(email, {
      redirectTo: redirectTo,
    });

    if (result.error) {
      throw result.error;
    }

    if (errorEl) {
      errorEl.style.color = "#047857";
      errorEl.textContent = "Enviamos um link de redefinição para seu email.";
    }
  } catch (err) {
    if (errorEl) {
      errorEl.style.color = "#dc2626";
      errorEl.textContent = err && err.message ? err.message : "Erro ao enviar email de recuperação.";
    }
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

  await clearTokens();
  var extensionApi = getExtensionApi();
  if (extensionApi && extensionApi.storage && extensionApi.storage.local) {
    await extensionApi.storage.local.remove("minutario_user_id");
  }
  hidePasswordForm();
  setAccountStatus("");
  showLogin();
}

async function handleChangePassword(event) {
  event.preventDefault();

  var newPasswordEl = document.getElementById("new-password");
  var confirmPasswordEl = document.getElementById("confirm-password");

  var newPassword = newPasswordEl ? newPasswordEl.value : "";
  var confirmPassword = confirmPasswordEl ? confirmPasswordEl.value : "";

  if (!newPassword || newPassword.length < 8) {
    setAccountStatus("A nova senha deve ter pelo menos 8 caracteres.", true);
    return;
  }

  if (newPassword !== confirmPassword) {
    setAccountStatus("A confirmação da senha não confere.", true);
    return;
  }

  try {
    var client = window.MinutarioAPI.getClient();
    if (!client) {
      throw new Error("Cliente Supabase não disponível");
    }

    var result = await client.auth.updateUser({ password: newPassword });
    if (result.error) {
      throw result.error;
    }

    hidePasswordForm();
    setAccountStatus("Senha atualizada com sucesso.");
  } catch (err) {
    var message = err && err.message ? String(err.message) : "Erro ao atualizar senha.";
    setAccountStatus(message, true);
  }
}

function openQuickAccess() {
  var extensionApi = getExtensionApi();
  extensionApi.runtime.sendMessage({
    type: "OPEN_QUICK_ACCESS",
    payload: { focusExisting: true },
  });
}

function openDashboard() {
  var extensionApi = getExtensionApi();
  var url = extensionApi.runtime.getURL("dashboard/dashboard.html");
  extensionApi.tabs.create({ url: url });
}

async function forceSync() {
  var statusEl = document.getElementById("sync-status");
  if (statusEl) statusEl.textContent = "Sincronizando...";

  try {
    var extensionApi = getExtensionApi();
    var response = await extensionApi.runtime.sendMessage({ type: "FORCE_SYNC" });
    if (response.ok && response.data && response.data.updated) {
      if (statusEl)
        statusEl.textContent =
          "Sincronizado (" + (response.data.count || 0) + " templates)";
    } else if (response.ok && response.data && response.data.error) {
      if (statusEl) statusEl.textContent = "Erro: " + response.data.error;
    } else if (response.ok) {
      if (statusEl) statusEl.textContent = "Erro na sincronização";
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
    var extensionApi = getExtensionApi();
    var response = await extensionApi.runtime.sendMessage({ type: "GET_SYNC_STATE" });
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
  var extensionApi = getExtensionApi();
  var localData = await extensionApi.storage.local.get("recent");
  var recent = Array.isArray(localData.recent)
    ? localData.recent.slice(0, 3)
    : [];

  if (recent.length === 0) {
    renderEmptyState(container);
    return;
  }

  var allTemplatesResponse;
  try {
    allTemplatesResponse = await extensionApi.runtime.sendMessage({ type: "GET_TEMPLATES", payload: {} });
  } catch (e) {
    renderEmptyState(container);
    return;
  }

  var allTemplates = (allTemplatesResponse && allTemplatesResponse.ok && Array.isArray(allTemplatesResponse.data))
    ? allTemplatesResponse.data
    : [];

  var templateById = {};
  allTemplates.forEach(function (t) {
    if (t && t.id) templateById[t.id] = t;
  });

  var validTemplates = recent
    .map(function (id) { return { id: id, template: templateById[id] }; })
    .filter(function (item) { return item.template && item.template.content; });

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
  var template = initialTemplate;

  if (!template || !template.content) {
    return;
  }

  var plain = stripHtml(template.content);

  if (window.MinutarioRichClipboard && window.MinutarioRichClipboard.copyRichText) {
    await window.MinutarioRichClipboard.copyRichText(template.content, plain, {
      document: document,
      navigator: navigator,
      ClipboardItem: window.ClipboardItem,
      Blob: window.Blob,
    });
  } else {
    await navigator.clipboard.write([
      new ClipboardItem({
        "text/html": new Blob([template.content], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      }),
    ]);
  }

  var originalMarkup = button.innerHTML;
  button.textContent = "Copiado!";

  window.setTimeout(function () {
    button.innerHTML = originalMarkup;
  }, 1500);
}

function stripHtml(html) {
  if (window.MinutarioRichClipboard && window.MinutarioRichClipboard.stripHtml) {
    return window.MinutarioRichClipboard.stripHtml(html);
  }

  var parser = document.createElement("div");
  parser.innerHTML = html;
  return (parser.textContent || parser.innerText || "").trim();
}

function renderEmptyState(container) {
  container.innerHTML = "";
}
