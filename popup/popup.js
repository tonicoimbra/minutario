document.addEventListener("DOMContentLoaded", function () {
  var loginForm = document.getElementById("login-form");
  var openQuickAccessBtn = document.getElementById("open-quick-access");
  var openDashboardBtn = document.getElementById("open-dashboard");
  var forceSyncBtn = document.getElementById("force-sync");
  var copyWordProbeBtn = document.getElementById("copy-word-probe");
  var logoutBtn = document.getElementById("logout");
  var toggleAuthBtn = document.getElementById("toggle-auth-mode");
  var backToLoginBtn = document.getElementById("back-to-login");

  if (loginForm) {
    loginForm.addEventListener("submit", handleLogin);
  }

  if (backToLoginBtn) {
    backToLoginBtn.addEventListener("click", function() {
      var loginSection = document.getElementById("login-section");
      var confirmationSection = document.getElementById("confirmation-section");
      if (confirmationSection) confirmationSection.classList.add("hidden");
      if (loginSection) loginSection.classList.remove("hidden");

      loginForm.dataset.mode = "login";
      var loginBtn = document.getElementById("login-btn");
      if (loginBtn) loginBtn.textContent = "Entrar";
      if (toggleAuthBtn) toggleAuthBtn.textContent = "Não tem conta? Criar agora";

      var confirmPwd = document.getElementById("login-password-confirm");
      if (confirmPwd) {
        confirmPwd.classList.add("hidden");
        confirmPwd.removeAttribute("required");
        confirmPwd.value = "";
      }
      var pwd = document.getElementById("login-password");
      if (pwd) pwd.value = "";
    });
  }

  if (toggleAuthBtn) {
    toggleAuthBtn.addEventListener("click", function(e) {
      e.preventDefault();
      var isSignUp = loginForm.dataset.mode === "signup";
      var loginBtn = document.getElementById("login-btn");
      var errorEl = document.getElementById("login-error");
      var confirmPwd = document.getElementById("login-password-confirm");

      if (isSignUp) {
        loginForm.dataset.mode = "login";
        loginBtn.textContent = "Entrar";
        toggleAuthBtn.textContent = "Não tem conta? Criar agora";
        if (confirmPwd) {
          confirmPwd.classList.add("hidden");
          confirmPwd.removeAttribute("required");
        }
      } else {
        loginForm.dataset.mode = "signup";
        loginBtn.textContent = "Criar Conta";
        toggleAuthBtn.textContent = "Já tem uma conta? Entrar";
        if (confirmPwd) {
          confirmPwd.classList.remove("hidden");
          confirmPwd.setAttribute("required", "true");
        }
      }
      if (errorEl) {
        errorEl.textContent = "";
        errorEl.style.color = "";
      }
    });
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

  if (copyWordProbeBtn) {
    copyWordProbeBtn.addEventListener("click", copyWordProbe);
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

function shouldFallbackToLogin(signUpError) {
  var message = signUpError && signUpError.message ? String(signUpError.message) : "";
  return /user already registered/i.test(message);
}

function showLogin() {
  var loginSection = document.getElementById("login-section");
  var dashboardSection = document.getElementById("dashboard-section");
  var confirmationSection = document.getElementById("confirmation-section");
  if (loginSection) loginSection.classList.remove("hidden");
  if (dashboardSection) dashboardSection.classList.add("hidden");
  if (confirmationSection) confirmationSection.classList.add("hidden");
}

function showDashboard(user) {
  var loginSection = document.getElementById("login-section");
  var dashboardSection = document.getElementById("dashboard-section");
  var confirmationSection = document.getElementById("confirmation-section");
  var userEmailEl = document.getElementById("user-email");
  var recentList = document.getElementById("recent-list");

  if (loginSection) loginSection.classList.add("hidden");
  if (dashboardSection) dashboardSection.classList.remove("hidden");
  if (confirmationSection) confirmationSection.classList.add("hidden");

  if (userEmailEl) {
    userEmailEl.textContent = user && user.email ? user.email : "Usuário";
  }

  if (recentList) {
    loadRecentTemplates(recentList);
  }

  updateSyncStatus();
}

function setWordProbeStatus(message, isError) {
  var statusEl = document.getElementById("word-probe-status");
  if (!statusEl) {
    return;
  }

  statusEl.textContent = message || "";
  statusEl.style.color = isError ? "#dc2626" : "";
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
  var isSignUp = document.getElementById("login-form").dataset.mode === "signup";

  try {
    var client = window.MinutarioAPI.getClient();
    if (!client) {
      throw new Error("Cliente Supabase não disponível");
    }

    var result;
    if (isSignUp) {
      var confirmPwd = document.getElementById("login-password-confirm").value;
      if (password.length < 8) {
        throw new Error("A senha deve ter pelo menos 8 caracteres");
      }
      if (password !== confirmPwd) {
        throw new Error("As senhas não coincidem");
      }

      result = await client.auth.signUp({
        email: email,
        password: password,
      });
      if (result.error) {
        if (shouldFallbackToLogin(result.error)) {
          result = await client.auth.signInWithPassword({
            email: email,
            password: password,
          });
        } else {
          throw result.error;
        }
      }
      if (result.error) throw result.error;

      if (!result.data.session) {
        var loginSection = document.getElementById("login-section");
        var confirmationSection = document.getElementById("confirmation-section");
        if (loginSection) loginSection.classList.add("hidden");
        if (confirmationSection) confirmationSection.classList.remove("hidden");
        return;
      }
    } else {
      result = await client.auth.signInWithPassword({
        email: email,
        password: password,
      });
      if (result.error) throw result.error;
    }

    var session = result.data.session;
    var user = result.data.user;

    if (!session) {
      throw new Error("Sessão não retornada");
    }

    saveTokens(session);

    var userId = user && user.id ? user.id : null;
    if (userId) {
      await chrome.storage.local.set({ minutario_user_id: userId });
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
  await chrome.storage.local.remove("minutario_user_id");
  showLogin();
}

function openQuickAccess() {
  chrome.runtime.sendMessage({
    type: "OPEN_QUICK_ACCESS",
    payload: { focusExisting: true },
  });
}

function openDashboard() {
  var url = chrome.runtime.getURL("dashboard/dashboard.html");
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

async function copyWordProbe() {
  try {
    var stored = await chrome.storage.local.get("minutario_last_word_probe");
    var probe = stored && stored.minutario_last_word_probe;

    if (!probe) {
      setWordProbeStatus("Nenhum diagnóstico do Word salvo ainda.", true);
      return;
    }

    var serialized = JSON.stringify(probe, null, 2);

    if (
      navigator.clipboard &&
      typeof navigator.clipboard.writeText === "function"
    ) {
      await navigator.clipboard.writeText(serialized);
      setWordProbeStatus("Diagnóstico copiado.");
      return;
    }

    setWordProbeStatus("Clipboard indisponível neste popup.", true);
  } catch (error) {
    setWordProbeStatus("Falha ao copiar diagnóstico.", true);
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

  var allTemplatesResponse;
  try {
    allTemplatesResponse = await chrome.runtime.sendMessage({ type: "GET_TEMPLATES", payload: {} });
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
