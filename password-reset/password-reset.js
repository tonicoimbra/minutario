(function () {
  "use strict";

  var ui = window.MinutarioAuthUI || {};
  var recoveryReady = false;
  var statusEl = null;
  var submitBtn = null;
  var newPasswordEl = null;
  var confirmPasswordEl = null;
  var passwordStrengthEl = null;
  var passwordErrorEl = null;
  var confirmErrorEl = null;

  function setStatus(message, type) {
    if (!statusEl) return;
    if (ui.setStatus) {
      ui.setStatus(statusEl, message, type || "");
      return;
    }
    statusEl.textContent = message || "";
  }

  function getParamsFromHash() {
    var hash = window.location.hash ? window.location.hash.replace(/^#/, "") : "";
    return new URLSearchParams(hash);
  }

  async function restoreRecoverySession(client) {
    var url = new URL(window.location.href);
    var code = url.searchParams.get("code");
    var hashParams = getParamsFromHash();
    var accessToken = hashParams.get("access_token");
    var refreshToken = hashParams.get("refresh_token");

    if (code && client.auth.exchangeCodeForSession) {
      var codeResult = await client.auth.exchangeCodeForSession(code);
      if (codeResult.error) throw codeResult.error;
      recoveryReady = true;
      return;
    }

    if (accessToken && refreshToken) {
      var sessionResult = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionResult.error) throw sessionResult.error;
      recoveryReady = true;
      return;
    }

    var current = await client.auth.getSession();
    recoveryReady = !!(current && current.data && current.data.session);
  }

  function setButtonLoading(isLoading, label) {
    if (!submitBtn) return;
    if (!submitBtn.dataset.defaultLabel) {
      submitBtn.dataset.defaultLabel = submitBtn.querySelector(".btn-text")
        ? submitBtn.querySelector(".btn-text").textContent
        : submitBtn.textContent;
    }
    var textEl = submitBtn.querySelector(".btn-text");
    if (isLoading) {
      submitBtn.disabled = true;
      if (textEl) {
        textEl.textContent = label || "Salvando...";
      }
      if (!submitBtn.querySelector(".spinner")) {
        var spinner = document.createElement("span");
        spinner.className = "spinner";
        submitBtn.querySelector(".auth-submit-content").appendChild(spinner);
      }
      return;
    }
    submitBtn.disabled = false;
    if (textEl) {
      textEl.textContent = submitBtn.dataset.defaultLabel || "Salvar nova senha";
    }
    var spinnerEl = submitBtn.querySelector(".spinner");
    if (spinnerEl) spinnerEl.remove();
  }

  function updatePasswordFeedback() {
    if (!newPasswordEl) return null;
    var validation = ui.validatePassword ? ui.validatePassword(newPasswordEl.value) : null;
    if (ui.setPasswordStrength) {
      ui.setPasswordStrength(passwordStrengthEl, validation);
    }
    if (ui.getPasswordHint && passwordErrorEl) {
      passwordErrorEl.textContent = ui.getPasswordHint(validation);
    }
    updateConfirmFeedback();
    return validation;
  }

  function updateConfirmFeedback() {
    if (!confirmPasswordEl || !confirmErrorEl) return;
    if (!confirmPasswordEl.value) {
      confirmErrorEl.textContent = "";
      return;
    }
    if (newPasswordEl.value !== confirmPasswordEl.value) {
      confirmErrorEl.textContent = "As senhas não coincidem.";
      return;
    }
    confirmErrorEl.textContent = "";
  }

  async function handleSubmit(event) {
    event.preventDefault();

    if (!recoveryReady) {
      setStatus("Link expirado. Solicite um novo e-mail de redefinição.", "error");
      return;
    }

    var validation = updatePasswordFeedback();
    if (!validation || !validation.valid) {
      setStatus("Senha fraca. Ajuste os critérios obrigatórios.", "error");
      return;
    }

    if (newPasswordEl.value !== confirmPasswordEl.value) {
      setStatus("As senhas não coincidem.", "error");
      return;
    }

    setButtonLoading(true, "Salvando...");

    try {
      var client = window.MinutarioAPI.getClient();
      var result = await client.auth.updateUser({ password: newPasswordEl.value });
      if (result.error) throw result.error;

      // Tenta recuperar e salvar a nova sessão na extensão para login automático
      try {
        var sessionResult = await client.auth.getSession();
        var session = sessionResult && sessionResult.data ? sessionResult.data.session : null;
        if (session && window.MinutarioAPI && window.MinutarioAPI.saveAuthSession) {
          await window.MinutarioAPI.saveAuthSession(session);
          var userId = session.user ? session.user.id : null;
          var extensionApi = typeof browser !== "undefined" ? browser : (typeof chrome !== "undefined" ? chrome : null);
          if (userId && extensionApi && extensionApi.storage && extensionApi.storage.local) {
            await extensionApi.storage.local.set({ minutario_user_id: userId });
          }
        }
      } catch (sessionErr) {
        console.error("Erro ao salvar sessão após reset:", sessionErr);
      }

      setStatus("Senha atualizada com sucesso.", "success");
      event.target.reset();
      updatePasswordFeedback();

      // Exibe a tela de sucesso e inicia contagem regressiva
      var resetContainer = document.getElementById("reset-container");
      var successContainer = document.getElementById("success-container");
      var countdownEl = document.getElementById("countdown");

      if (resetContainer) resetContainer.style.display = "none";
      if (successContainer) successContainer.style.display = "block";

      var seconds = 3;
      if (countdownEl) countdownEl.textContent = String(seconds);
      var interval = setInterval(function () {
        seconds -= 1;
        if (countdownEl) countdownEl.textContent = String(seconds);
        if (seconds <= 0) {
          clearInterval(interval);
          var dashboardUrl = "../dashboard/dashboard.html";
          window.location.href = dashboardUrl;
        }
      }, 1000);

    } catch (err) {
      setStatus(
        ui.mapSupabaseError
          ? ui.mapSupabaseError(err, "Erro ao atualizar senha.")
          : (err && err.message ? err.message : "Erro ao atualizar senha."),
        "error"
      );
    } finally {
      setButtonLoading(false);
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    statusEl = document.getElementById("status");
    submitBtn = document.getElementById("reset-submit-btn");
    newPasswordEl = document.getElementById("new-password");
    confirmPasswordEl = document.getElementById("confirm-password");
    passwordStrengthEl = document.getElementById("password-strength");
    passwordErrorEl = document.getElementById("password-error");
    confirmErrorEl = document.getElementById("confirm-error");

    if (ui.setupPasswordToggle) {
      ui.setupPasswordToggle(newPasswordEl, document.getElementById("toggle-new-password"));
      ui.setupPasswordToggle(confirmPasswordEl, document.getElementById("toggle-confirm-password"));
    }

    if (newPasswordEl) newPasswordEl.addEventListener("input", updatePasswordFeedback);
    if (confirmPasswordEl) confirmPasswordEl.addEventListener("input", updateConfirmFeedback);

    var form = document.getElementById("reset-form");
    if (form) form.addEventListener("submit", handleSubmit);

    try {
      var client = window.MinutarioAPI.getClient();
      if (!client) throw new Error("Cliente Supabase não disponível.");
      await restoreRecoverySession(client);
      if (recoveryReady) {
        setStatus("Digite e confirme sua nova senha.", "success");
      } else {
        setStatus("Link expirado. Solicite um novo e-mail de redefinição.", "error");
      }
    } catch (err) {
      setStatus(
        ui.mapSupabaseError
          ? ui.mapSupabaseError(err, "Erro ao abrir link de recuperação.")
          : (err && err.message ? err.message : "Erro ao abrir link de recuperação."),
        "error"
      );
    }
  });
})();
