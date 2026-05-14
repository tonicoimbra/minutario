document.addEventListener("DOMContentLoaded", function () {
  var fallbackUi = {
    buildInstitutionalEmail: function (value) {
      var clean = String(value || "").trim();
      if (!clean) {
        return { ok: false, error: "Informe seu e-mail institucional.", email: "", identifier: "" };
      }
      if (clean.indexOf("@") === -1) {
        return { ok: true, email: clean + "@tjpr.jus.br", identifier: clean };
      }
      var identifier = clean.split("@")[0] || "";
      if (clean.toLowerCase().indexOf("@tjpr.jus.br") !== clean.length - "@tjpr.jus.br".length) {
        return { ok: false, error: "Apenas e-mails @tjpr.jus.br são permitidos.", email: clean, identifier: identifier };
      }
      return { ok: true, email: clean, identifier: identifier };
    },
    mapSupabaseError: function (err, fallback) {
      return err && err.message ? err.message : (fallback || "Erro inesperado.");
    },
    isEmailNotConfirmedError: function (message) {
      var text = String(message || "").toLowerCase();
      return text.indexOf("email not confirmed") !== -1 || text.indexOf("confirm") !== -1;
    },
    createCooldown: function (seconds, onTick, onDone) {
      var remaining = seconds;
      var timer = setInterval(function () {
        remaining -= 1;
        if (typeof onTick === "function") onTick(Math.max(remaining, 0));
        if (remaining <= 0) {
          clearInterval(timer);
          if (typeof onDone === "function") onDone();
        }
      }, 1000);
      if (typeof onTick === "function") onTick(remaining);
      return { stop: function () { clearInterval(timer); } };
    },
  };
  var ui = Object.assign({}, fallbackUi, window.MinutarioAuthUI || {});
  var extensionApi = getExtensionApi();
  var resendCooldown = null;
  var resendEmail = "";

  var els = {
    authSection: document.getElementById("auth-section"),
    dashboardSection: document.getElementById("dashboard-section"),
    loginView: document.getElementById("login-view"),
    signupView: document.getElementById("signup-view"),
    forgotView: document.getElementById("forgot-view"),
    loginForm: document.getElementById("login-form"),
    signupForm: document.getElementById("signup-form"),
    forgotForm: document.getElementById("forgot-form"),
    loginEmailId: document.getElementById("login-email-id"),
    loginEmailLegacy: document.getElementById("login-email"),
    loginPassword: document.getElementById("login-password"),
    loginEmailError: document.getElementById("login-email-error"),
    loginStatus: document.getElementById("login-status"),
    loginErrorLegacy: document.getElementById("login-error"),
    signupEmailId: document.getElementById("signup-email-id"),
    signupPassword: document.getElementById("signup-password"),
    signupPasswordConfirm: document.getElementById("signup-password-confirm"),
    signupEmailError: document.getElementById("signup-email-error"),
    signupPasswordError: document.getElementById("signup-password-error"),
    signupConfirmError: document.getElementById("signup-confirm-error"),
    signupPasswordStrength: document.getElementById("signup-password-strength"),
    signupStatus: document.getElementById("signup-status"),
    signupSuccessBox: document.getElementById("signup-success-box"),
    signupLgpdAccept: document.getElementById("signup-lgpd-accept"),
    signupBtn: document.getElementById("signup-btn"),
    forgotEmailId: document.getElementById("forgot-email-id"),
    forgotEmailError: document.getElementById("forgot-email-error"),
    forgotStatus: document.getElementById("forgot-status"),
    resendWrap: document.getElementById("resend-confirmation-wrap"),
    resendButton: document.getElementById("resend-confirmation-btn"),
    resendCountdown: document.getElementById("resend-countdown"),
    userEmail: document.getElementById("user-email"),
    syncStatus: document.getElementById("sync-status"),
    accountStatus: document.getElementById("account-status"),
    openQuickAccessBtn: document.getElementById("open-quick-access"),
    openDashboardBtn: document.getElementById("open-dashboard"),
    forceSyncBtn: document.getElementById("force-sync"),
    logoutBtn: document.getElementById("logout"),
    togglePasswordFormBtn: document.getElementById("toggle-password-form"),
    legacyPasswordForm: document.getElementById("password-form"),
    legacyNewPassword: document.getElementById("new-password"),
    legacyConfirmPassword: document.getElementById("confirm-password"),
    appVersion: document.getElementById("app-version"),
    goForgot: document.getElementById("go-forgot"),
    forgotPasswordLegacyBtn: document.getElementById("forgot-password"),
    goSignup: document.getElementById("go-signup"),
    backToLoginFromSignup: document.getElementById("back-to-login-from-signup"),
    backToLoginFromForgot: document.getElementById("back-to-login-from-forgot"),
    termsLink: document.getElementById("terms-link"),
    privacyLink: document.getElementById("privacy-link"),
  };

  bindEvents();
  setupToggles();
  setPopupVersion();
  setLegalLinks();
  checkAuth();

  function bindEvents() {
    if (els.loginForm) els.loginForm.addEventListener("submit", handleLogin);
    if (els.signupForm) els.signupForm.addEventListener("submit", handleSignup);
    if (els.forgotForm) els.forgotForm.addEventListener("submit", handleForgotPassword);
    if (els.forgotPasswordLegacyBtn) els.forgotPasswordLegacyBtn.addEventListener("click", handleLegacyForgotPassword);
    if (els.togglePasswordFormBtn) els.togglePasswordFormBtn.addEventListener("click", toggleLegacyPasswordForm);
    if (els.legacyPasswordForm) els.legacyPasswordForm.addEventListener("submit", handleLegacyPasswordChange);
    if (els.logoutBtn) els.logoutBtn.addEventListener("click", handleLogout);
    if (els.forceSyncBtn) els.forceSyncBtn.addEventListener("click", forceSync);
    if (els.openDashboardBtn) els.openDashboardBtn.addEventListener("click", openDashboard);
    if (els.openQuickAccessBtn) els.openQuickAccessBtn.addEventListener("click", openQuickAccess);
    if (els.goForgot) els.goForgot.addEventListener("click", function () { showAuthView("forgot"); });
    if (els.goSignup) els.goSignup.addEventListener("click", function () { showAuthView("signup"); });
    if (els.backToLoginFromSignup) els.backToLoginFromSignup.addEventListener("click", function () { showAuthView("login"); });
    if (els.backToLoginFromForgot) els.backToLoginFromForgot.addEventListener("click", function () { showAuthView("login"); });
    if (els.resendButton) els.resendButton.addEventListener("click", handleResendConfirmation);
    if (els.signupLgpdAccept) {
      els.signupLgpdAccept.addEventListener("change", function () {
        els.signupBtn.disabled = !els.signupLgpdAccept.checked;
      });
    }
    if (els.signupPassword) {
      els.signupPassword.addEventListener("input", updatePasswordFeedback);
    }
    if (els.signupPasswordConfirm) {
      els.signupPasswordConfirm.addEventListener("input", updatePasswordConfirmFeedback);
    }
    if (els.loginEmailId && els.loginEmailLegacy) {
      els.loginEmailId.addEventListener("input", function () {
        els.loginEmailLegacy.value = els.loginEmailId.value;
      });
    }
  }

  function setupToggles() {
    if (!ui.setupPasswordToggle) return;
    ui.setupPasswordToggle(document.getElementById("login-password"), document.getElementById("toggle-login-password"));
    ui.setupPasswordToggle(document.getElementById("signup-password"), document.getElementById("toggle-signup-password"));
    ui.setupPasswordToggle(document.getElementById("signup-password-confirm"), document.getElementById("toggle-signup-password-confirm"));
  }

  function setPopupVersion() {
    if (!els.appVersion) return;
    try {
      var manifest = extensionApi && extensionApi.runtime && extensionApi.runtime.getManifest
        ? extensionApi.runtime.getManifest()
        : null;
      els.appVersion.textContent = manifest && manifest.version ? "v" + manifest.version : "v-";
    } catch (err) {
      els.appVersion.textContent = "v-";
    }
  }

  function setLegalLinks() {
    var termsUrl = extensionApi && extensionApi.runtime && extensionApi.runtime.getURL
      ? extensionApi.runtime.getURL("shared/terms.html")
      : "shared/terms.html";
    var privacyUrl = extensionApi && extensionApi.runtime && extensionApi.runtime.getURL
      ? extensionApi.runtime.getURL("shared/privacy.html")
      : "shared/privacy.html";

    if (els.termsLink) {
      els.termsLink.href = termsUrl;
      els.termsLink.addEventListener("click", function (event) {
        event.preventDefault();
        openExternalPage(termsUrl);
      });
    }

    if (els.privacyLink) {
      els.privacyLink.href = privacyUrl;
      els.privacyLink.addEventListener("click", function (event) {
        event.preventDefault();
        openExternalPage(privacyUrl);
      });
    }
  }

  function openExternalPage(url) {
    if (extensionApi && extensionApi.tabs && extensionApi.tabs.create) {
      extensionApi.tabs.create({ url: url });
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  function clearFormMessages() {
    safeSetError(els.loginEmailError, "");
    safeSetStatus(els.loginStatus, "");
    safeSetError(els.signupEmailError, "");
    safeSetError(els.signupPasswordError, "");
    safeSetError(els.signupConfirmError, "");
    safeSetStatus(els.signupStatus, "");
    safeSetError(els.forgotEmailError, "");
    safeSetStatus(els.forgotStatus, "");
  }

  function safeSetError(el, message) {
    if (ui.setFieldError) {
      ui.setFieldError(el, message);
    } else if (el) {
      el.textContent = message || "";
    }
  }

  function safeSetStatus(el, message, type) {
    if (ui.setStatus) {
      ui.setStatus(el, message, type);
    } else if (el) {
      el.textContent = message || "";
    }
    if (els.loginErrorLegacy && el === els.loginStatus) {
      els.loginErrorLegacy.textContent = message || "";
    }
  }

  function showAuthSection() {
    if (els.authSection) els.authSection.classList.remove("hidden");
    if (els.dashboardSection) els.dashboardSection.classList.add("hidden");
  }

  function showDashboard(user) {
    if (els.authSection) els.authSection.classList.add("hidden");
    if (els.dashboardSection) els.dashboardSection.classList.remove("hidden");
    if (els.userEmail) {
      els.userEmail.textContent = user && user.email ? user.email : "Usuário";
    }
    if (els.accountStatus) {
      els.accountStatus.textContent = "";
    }
    updateSyncStatus();
  }

  window.showDashboard = showDashboard;

  function showAuthView(viewName) {
    clearFormMessages();
    if (els.signupSuccessBox) els.signupSuccessBox.classList.add("hidden");
    if (els.loginView) els.loginView.classList.add("hidden");
    if (els.signupView) els.signupView.classList.add("hidden");
    if (els.forgotView) els.forgotView.classList.add("hidden");

    if (viewName === "signup" && els.signupView) {
      els.signupView.classList.remove("hidden");
      els.signupView.classList.add("fade-enter");
    } else if (viewName === "forgot" && els.forgotView) {
      els.forgotView.classList.remove("hidden");
      els.forgotView.classList.add("fade-enter");
    } else if (els.loginView) {
      els.loginView.classList.remove("hidden");
      els.loginView.classList.add("fade-enter");
    }
    showAuthSection();
  }

  function getConfirmationRedirectUrl() {
    if (extensionApi && extensionApi.runtime && extensionApi.runtime.getURL) {
      return extensionApi.runtime.getURL("shared/confirmed.html");
    }
    return "";
  }

  function getResetRedirectUrl() {
    var config = window.MinutarioConfig || {};
    if (config.PASSWORD_RESET_REDIRECT_URL) return config.PASSWORD_RESET_REDIRECT_URL;
    if (extensionApi && extensionApi.runtime && extensionApi.runtime.getURL) {
      return extensionApi.runtime.getURL("password-reset/password-reset.html");
    }
    return "";
  }

  function setButtonLoading(buttonEl, isLoading, label) {
    if (!buttonEl) return;
    var textEl = buttonEl.querySelector(".btn-text");
    if (!buttonEl.dataset.defaultLabel) {
      buttonEl.dataset.defaultLabel = textEl ? textEl.textContent : buttonEl.textContent;
    }

    if (isLoading) {
      buttonEl.disabled = true;
      if (textEl) {
        textEl.textContent = label || "Processando...";
      } else {
        buttonEl.textContent = label || "Processando...";
      }
      if (!buttonEl.querySelector(".spinner")) {
        var spinner = document.createElement("span");
        spinner.className = "spinner";
        buttonEl.querySelector(".auth-submit-content")
          ? buttonEl.querySelector(".auth-submit-content").appendChild(spinner)
          : buttonEl.appendChild(spinner);
      }
      return;
    }

    if (textEl) {
      textEl.textContent = buttonEl.dataset.defaultLabel || label || "";
    } else {
      buttonEl.textContent = buttonEl.dataset.defaultLabel || label || "";
    }
    var existingSpinner = buttonEl.querySelector(".spinner");
    if (existingSpinner) existingSpinner.remove();
    if (buttonEl.id !== "signup-btn" || !els.signupLgpdAccept || els.signupLgpdAccept.checked) {
      buttonEl.disabled = false;
    }
  }

  function updatePasswordFeedback() {
    var validation = ui.validatePassword ? ui.validatePassword(els.signupPassword.value) : null;
    if (ui.setPasswordStrength) {
      ui.setPasswordStrength(els.signupPasswordStrength, validation);
    }
    if (ui.getPasswordHint) {
      safeSetError(els.signupPasswordError, ui.getPasswordHint(validation));
    }
    updatePasswordConfirmFeedback();
  }

  function updatePasswordConfirmFeedback() {
    var password = els.signupPassword ? els.signupPassword.value : "";
    var confirm = els.signupPasswordConfirm ? els.signupPasswordConfirm.value : "";
    if (!confirm) {
      safeSetError(els.signupConfirmError, "");
      return;
    }
    if (password !== confirm) {
      safeSetError(els.signupConfirmError, "As senhas não coincidem.");
      return;
    }
    safeSetError(els.signupConfirmError, "");
  }

  async function checkAuth() {
    showAuthView("login");

    try {
      var client = window.MinutarioAPI.getClient();
      if (!client) return;
      if (window.MinutarioAPI.restoreSessionFromStorage) {
        await window.MinutarioAPI.restoreSessionFromStorage(client);
      }
      var userResult = await client.auth.getUser();
      if (!userResult.error && userResult.data && userResult.data.user) {
        showDashboard(userResult.data.user);
      }
    } catch (err) {
      showAuthView("login");
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    clearFormMessages();
    hideResendWrap();

    var loginIdentifier = "";
    if (els.loginEmailId && els.loginEmailId.value) {
      loginIdentifier = els.loginEmailId.value;
    } else if (els.loginEmailLegacy && els.loginEmailLegacy.value) {
      loginIdentifier = els.loginEmailLegacy.value;
    }
    var emailResult = ui.buildInstitutionalEmail(loginIdentifier);
    if (!emailResult.ok && loginIdentifier && loginIdentifier.indexOf("@") !== -1 && els.loginEmailLegacy && els.loginEmailLegacy.value) {
      emailResult = {
        ok: true,
        email: String(loginIdentifier).trim(),
        identifier: String(loginIdentifier).split("@")[0] || "",
      };
    }
    if (!emailResult.ok) {
      safeSetError(els.loginEmailError, emailResult.error);
      return;
    }

    if (!els.loginPassword || !els.loginPassword.value) {
      safeSetStatus(els.loginStatus, "Informe sua senha.", "error");
      return;
    }

    setButtonLoading(document.getElementById("login-btn"), true, "Entrando...");

    try {
      var client = window.MinutarioAPI.getClient();
      if (!client) throw new Error("Cliente Supabase não disponível.");

      var result = await client.auth.signInWithPassword({
        email: emailResult.email,
        password: els.loginPassword.value,
      });
      if (result.error) throw result.error;
      if (!result.data || !result.data.session) throw new Error("Sessão não retornada.");

      await window.MinutarioAPI.saveAuthSession(result.data.session);
      resendEmail = emailResult.email;

      var user = result.data.user;
      var userId = user && user.id ? user.id : null;
      if (userId && extensionApi && extensionApi.storage && extensionApi.storage.local) {
        var previous = await extensionApi.storage.local.get("minutario_user_id");
        var previousUserId = previous && previous.minutario_user_id ? previous.minutario_user_id : null;
        if (window.MinutarioSync && window.MinutarioSync.prepareUserContext) {
          var switched = await window.MinutarioSync.prepareUserContext(userId, previousUserId);
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
        await extensionApi.storage.local.set({ minutario_user_id: userId });
      }

      safeSetStatus(els.loginStatus, "", "");
      showDashboard(user);
    } catch (err) {
      var message = ui.mapSupabaseError ? ui.mapSupabaseError(err, "Erro ao fazer login.") : String(err && err.message ? err.message : "Erro ao fazer login.");
      safeSetStatus(els.loginStatus, message, "error");
      if (ui.isEmailNotConfirmedError && ui.isEmailNotConfirmedError(err && err.message ? err.message : "")) {
        resendEmail = emailResult.email;
        showResendWrap();
      }
    } finally {
      setButtonLoading(document.getElementById("login-btn"), false);
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    clearFormMessages();
    if (els.signupSuccessBox) els.signupSuccessBox.classList.add("hidden");

    var emailResult = ui.buildInstitutionalEmail(els.signupEmailId ? els.signupEmailId.value : "");
    if (!emailResult.ok) {
      safeSetError(els.signupEmailError, emailResult.error);
      return;
    }

    var passwordValidation = ui.validatePassword ? ui.validatePassword(els.signupPassword.value) : null;
    if (!passwordValidation || !passwordValidation.valid) {
      safeSetError(els.signupPasswordError, ui.getPasswordHint ? ui.getPasswordHint(passwordValidation) : "Senha fraca.");
      return;
    }

    if (els.signupPassword.value !== els.signupPasswordConfirm.value) {
      safeSetError(els.signupConfirmError, "As senhas não coincidem.");
      return;
    }

    if (!els.signupLgpdAccept || !els.signupLgpdAccept.checked) {
      safeSetStatus(els.signupStatus, "Para continuar, aceite os Termos de Uso e a Política de Privacidade.", "error");
      return;
    }

    setButtonLoading(document.getElementById("signup-btn"), true, "Criando conta...");

    try {
      var client = window.MinutarioAPI.getClient();
      if (!client) throw new Error("Cliente Supabase não disponível.");

      var result = await client.auth.signUp({
        email: emailResult.email,
        password: els.signupPassword.value,
        options: {
          emailRedirectTo: getConfirmationRedirectUrl(),
        },
      });

      if (result.error) throw result.error;

      resendEmail = emailResult.email;
      if (els.signupSuccessBox) {
        els.signupSuccessBox.classList.remove("hidden");
        els.signupSuccessBox.textContent =
          "Conta criada com sucesso! Enviamos um e-mail de confirmação para " +
          emailResult.email +
          ". Acesse seu e-mail institucional do TJPR e clique no link de confirmação para ativar sua conta.";
      }
      safeSetStatus(els.signupStatus, "Você será redirecionado para o login.", "success");
      if (els.loginEmailId) els.loginEmailId.value = emailResult.identifier;
      showAuthView("login");
      safeSetStatus(els.loginStatus, "Conta criada. Confirme seu e-mail para entrar.", "success");
    } catch (err) {
      safeSetStatus(els.signupStatus, ui.mapSupabaseError ? ui.mapSupabaseError(err, "Erro ao criar conta.") : "Erro ao criar conta.", "error");
    } finally {
      setButtonLoading(document.getElementById("signup-btn"), false);
    }
  }

  async function handleForgotPassword(event) {
    event.preventDefault();
    clearFormMessages();

    var emailResult = ui.buildInstitutionalEmail(els.forgotEmailId ? els.forgotEmailId.value : "");
    if (!emailResult.ok) {
      safeSetError(els.forgotEmailError, emailResult.error);
      return;
    }

    setButtonLoading(document.getElementById("forgot-btn"), true, "Enviando...");

    try {
      var client = window.MinutarioAPI.getClient();
      if (!client) throw new Error("Cliente Supabase não disponível.");
      var result = await client.auth.resetPasswordForEmail(emailResult.email, {
        redirectTo: getResetRedirectUrl(),
      });
      if (result.error) throw result.error;

      safeSetStatus(
        els.forgotStatus,
        "Se o e-mail informado estiver cadastrado, você receberá um link para redefinição de senha.",
        "success"
      );
    } catch (err) {
      safeSetStatus(els.forgotStatus, ui.mapSupabaseError ? ui.mapSupabaseError(err, "Erro ao solicitar redefinição.") : "Erro ao solicitar redefinição.", "error");
    } finally {
      setButtonLoading(document.getElementById("forgot-btn"), false);
    }
  }

  async function handleLegacyForgotPassword() {
    clearFormMessages();
    var value = els.loginEmailLegacy && els.loginEmailLegacy.value
      ? els.loginEmailLegacy.value
      : (els.loginEmailId ? els.loginEmailId.value : "");
    var emailResult = ui.buildInstitutionalEmail(value);
    if (!emailResult.ok && value && value.indexOf("@") !== -1 && els.loginEmailLegacy && els.loginEmailLegacy.value) {
      emailResult = {
        ok: true,
        email: String(value).trim(),
        identifier: String(value).split("@")[0] || "",
      };
    }
    if (!emailResult.ok) {
      safeSetStatus(els.loginStatus, emailResult.error, "error");
      return;
    }
    try {
      var client = window.MinutarioAPI.getClient();
      var result = await client.auth.resetPasswordForEmail(emailResult.email, {
        redirectTo: getResetRedirectUrl(),
      });
      if (result.error) throw result.error;
      safeSetStatus(els.loginStatus, "Enviamos um link de redefinição para seu email.", "success");
    } catch (err) {
      safeSetStatus(els.loginStatus, ui.mapSupabaseError ? ui.mapSupabaseError(err, "Erro ao enviar recuperação.") : "Erro ao enviar recuperação.", "error");
    }
  }

  function showResendWrap() {
    if (els.resendWrap) els.resendWrap.classList.remove("hidden");
    if (els.resendCountdown) els.resendCountdown.textContent = "";
    if (els.resendButton) els.resendButton.disabled = false;
  }

  function hideResendWrap() {
    if (els.resendWrap) els.resendWrap.classList.add("hidden");
    if (resendCooldown && typeof resendCooldown.stop === "function") {
      resendCooldown.stop();
    }
    resendCooldown = null;
  }

  async function handleResendConfirmation() {
    if (!resendEmail) {
      safeSetStatus(els.loginStatus, "Informe seu e-mail e tente novamente.", "error");
      return;
    }

    if (els.resendButton) els.resendButton.disabled = true;
    if (els.resendCountdown) els.resendCountdown.textContent = "Enviando...";

    try {
      var client = window.MinutarioAPI.getClient();
      if (!client || !client.auth || typeof client.auth.resend !== "function") {
        throw new Error("Reenvio de confirmação não disponível nesta versão.");
      }

      var result = await client.auth.resend({
        type: "signup",
        email: resendEmail,
        options: { emailRedirectTo: getConfirmationRedirectUrl() },
      });

      if (result.error) throw result.error;
      safeSetStatus(els.loginStatus, "E-mail de confirmação reenviado com sucesso.", "success");
      startResendCooldown(60);
    } catch (err) {
      safeSetStatus(els.loginStatus, ui.mapSupabaseError ? ui.mapSupabaseError(err, "Falha ao reenviar confirmação.") : "Falha ao reenviar confirmação.", "error");
      if (els.resendButton) els.resendButton.disabled = false;
      if (els.resendCountdown) els.resendCountdown.textContent = "";
    }
  }

  function startResendCooldown(seconds) {
    if (resendCooldown && typeof resendCooldown.stop === "function") {
      resendCooldown.stop();
    }

    resendCooldown = ui.createCooldown
      ? ui.createCooldown(
          seconds,
          function (remaining) {
            if (els.resendCountdown) {
              els.resendCountdown.textContent =
                remaining > 0 ? "Aguarde " + remaining + "s para reenviar." : "";
            }
            if (els.resendButton) {
              els.resendButton.disabled = remaining > 0;
            }
          },
          function () {
            if (els.resendCountdown) els.resendCountdown.textContent = "";
            if (els.resendButton) els.resendButton.disabled = false;
          }
        )
      : null;
  }

  async function handleLogout() {
    try {
      var client = window.MinutarioAPI.getClient();
      if (client) {
        await client.auth.signOut();
      }
    } catch (err) {
      // ignore
    }

    await window.MinutarioAPI.clearAuthSession();
    if (extensionApi && extensionApi.storage && extensionApi.storage.local) {
      await extensionApi.storage.local.remove("minutario_user_id");
    }
    hideResendWrap();
    showAuthView("login");
  }

  function toggleLegacyPasswordForm() {
    if (!els.legacyPasswordForm) return;
    els.legacyPasswordForm.classList.toggle("hidden");
  }

  async function handleLegacyPasswordChange(event) {
    event.preventDefault();
    if (!els.legacyNewPassword || !els.legacyConfirmPassword) return;

    if (!els.legacyNewPassword.value || els.legacyNewPassword.value.length < 8) {
      if (els.accountStatus) els.accountStatus.textContent = "A nova senha deve ter pelo menos 8 caracteres.";
      return;
    }
    if (els.legacyNewPassword.value !== els.legacyConfirmPassword.value) {
      if (els.accountStatus) els.accountStatus.textContent = "As senhas não coincidem.";
      return;
    }

    try {
      var client = window.MinutarioAPI.getClient();
      var result = await client.auth.updateUser({ password: els.legacyNewPassword.value });
      if (result.error) throw result.error;
      if (els.accountStatus) els.accountStatus.textContent = "Senha atualizada com sucesso.";
      els.legacyPasswordForm.classList.add("hidden");
    } catch (err) {
      if (els.accountStatus) els.accountStatus.textContent = ui.mapSupabaseError ? ui.mapSupabaseError(err, "Erro ao atualizar senha.") : "Erro ao atualizar senha.";
    }
  }

  function openQuickAccess() {
    if (!extensionApi || !extensionApi.runtime || !extensionApi.runtime.sendMessage) return;
    extensionApi.runtime.sendMessage({
      type: "OPEN_QUICK_ACCESS",
      payload: { focusExisting: true },
    });
  }

  function openDashboard() {
    if (!extensionApi || !extensionApi.runtime || !extensionApi.runtime.getURL || !extensionApi.tabs) return;
    extensionApi.tabs.create({ url: extensionApi.runtime.getURL("dashboard/dashboard.html") });
  }

  async function forceSync() {
    if (els.syncStatus) els.syncStatus.textContent = "Sincronizando...";

    try {
      var response = await extensionApi.runtime.sendMessage({ type: "FORCE_SYNC" });
      if (response.ok && response.data && response.data.updated) {
        if (els.syncStatus) els.syncStatus.textContent = "Sincronizado (" + (response.data.count || 0) + " templates)";
      } else if (response.ok && response.data && response.data.error) {
        if (els.syncStatus) els.syncStatus.textContent = "Erro: " + response.data.error;
      } else {
        if (els.syncStatus) els.syncStatus.textContent = "Erro na sincronização";
      }
    } catch (err) {
      if (els.syncStatus) els.syncStatus.textContent = "Erro na sincronização";
    }
  }

  async function updateSyncStatus() {
    try {
      var response = await extensionApi.runtime.sendMessage({ type: "GET_SYNC_STATE" });
      if (response.ok && response.data) {
        var map = {
          idle: "Pronto",
          syncing: "Sincronizando...",
          updated: "Atualizado",
          offline: "Offline",
          error: "Erro",
        };
        if (els.syncStatus) els.syncStatus.textContent = map[response.data.state] || response.data.state;
      }
    } catch (err) {
      if (els.syncStatus) els.syncStatus.textContent = "Pronto";
    }
  }
});

function getExtensionApi() {
  if (typeof browser !== "undefined") return browser;
  if (typeof chrome !== "undefined") return chrome;
  return null;
}
