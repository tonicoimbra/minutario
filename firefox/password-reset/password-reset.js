(function () {
  "use strict";

  var recoveryReady = false;

  function setStatus(message, isError) {
    var el = document.getElementById("status");
    if (!el) return;
    el.textContent = message || "";
    el.style.color = isError ? "#dc2626" : "#047857";
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

  async function handleSubmit(event) {
    event.preventDefault();

    var newPassword = document.getElementById("new-password").value;
    var confirmPassword = document.getElementById("confirm-password").value;

    if (!recoveryReady) {
      setStatus("Link de recuperação inválido ou expirado. Solicite um novo link.", true);
      return;
    }

    if (!newPassword || newPassword.length < 8) {
      setStatus("A nova senha deve ter pelo menos 8 caracteres.", true);
      return;
    }

    if (newPassword !== confirmPassword) {
      setStatus("A confirmação da senha não confere.", true);
      return;
    }

    try {
      var client = window.MinutarioAPI.getClient();
      var result = await client.auth.updateUser({ password: newPassword });
      if (result.error) throw result.error;
      setStatus("Senha atualizada. Volte para a extensão e faça login.");
      event.target.reset();
    } catch (err) {
      setStatus(err && err.message ? err.message : "Erro ao atualizar senha.", true);
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    var form = document.getElementById("reset-form");
    if (form) form.addEventListener("submit", handleSubmit);

    try {
      var client = window.MinutarioAPI.getClient();
      if (!client) throw new Error("Cliente Supabase não disponível.");
      await restoreRecoverySession(client);
      if (recoveryReady) {
        setStatus("Digite sua nova senha.");
      } else {
        setStatus("Link de recuperação inválido ou expirado. Solicite um novo link.", true);
      }
    } catch (err) {
      setStatus(err && err.message ? err.message : "Erro ao abrir link de recuperação.", true);
    }
  });
})();
