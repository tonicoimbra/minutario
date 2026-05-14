(function (global) {
  "use strict";

  var DOMAIN = "@tjpr.jus.br";
  var SPECIAL_CHAR_REGEX = /[!@#$%^&*]/;
  var NUMBER_REGEX = /[0-9]/;
  var UPPERCASE_REGEX = /[A-Z]/;
  var EMAIL_REGEX = /^[a-z0-9._%+-]+@tjpr\.jus\.br$/i;

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function extractIdentifier(value) {
    var clean = normalizeText(value).replace(/\s+/g, "");
    if (!clean) return "";

    if (clean.indexOf("@") === -1) {
      return clean;
    }

    return clean.split("@")[0];
  }

  function buildInstitutionalEmail(value) {
    var clean = normalizeText(value).toLowerCase().replace(/\s+/g, "");
    var identifier = "";
    var email = "";

    if (!clean) {
      return {
        ok: false,
        identifier: "",
        email: "",
        error: "Informe seu e-mail institucional.",
      };
    }

    if (clean.indexOf("@") !== -1) {
      email = clean;
      identifier = extractIdentifier(clean).toLowerCase();
    } else {
      identifier = clean;
      email = identifier + DOMAIN;
    }

    if (identifier.length < 3) {
      return {
        ok: false,
        identifier: identifier,
        email: email,
        error: "Informe ao menos 3 caracteres antes de @tjpr.jus.br.",
      };
    }

    if (!/@tjpr\.jus\.br$/i.test(email)) {
      return {
        ok: false,
        identifier: identifier,
        email: email,
        error: "Apenas e-mails @tjpr.jus.br são permitidos.",
      };
    }

    if (!EMAIL_REGEX.test(email)) {
      return {
        ok: false,
        identifier: identifier,
        email: email,
        error: "Formato de e-mail inválido.",
      };
    }

    return {
      ok: true,
      identifier: identifier,
      email: email,
      error: "",
    };
  }

  function validatePassword(value) {
    var password = String(value || "");
    var checks = {
      minLength: password.length >= 8,
      hasUppercase: UPPERCASE_REGEX.test(password),
      hasNumber: NUMBER_REGEX.test(password),
      hasSpecial: SPECIAL_CHAR_REGEX.test(password),
    };
    var score = 0;
    if (checks.minLength) score += 1;
    if (checks.hasUppercase) score += 1;
    if (checks.hasNumber) score += 1;
    if (checks.hasSpecial) score += 1;

    var label = "fraca";
    if (score >= 4) {
      label = "forte";
    } else if (score >= 3) {
      label = "média";
    }

    return {
      valid:
        checks.minLength &&
        checks.hasUppercase &&
        checks.hasNumber &&
        checks.hasSpecial,
      score: score,
      label: label,
      checks: checks,
    };
  }

  function getPasswordHint(validation) {
    if (!validation || !validation.checks) {
      return "Senha fraca";
    }

    var missing = [];
    if (!validation.checks.minLength) missing.push("mínimo de 8 caracteres");
    if (!validation.checks.hasUppercase) missing.push("1 letra maiúscula");
    if (!validation.checks.hasNumber) missing.push("1 número");
    if (!validation.checks.hasSpecial) missing.push("1 caractere especial (!@#$%^&*)");

    if (!missing.length) {
      return "Senha forte";
    }

    return "Falta: " + missing.join(", ");
  }

  function setPasswordStrength(el, validation) {
    if (!el) return;
    var level = validation && validation.label ? validation.label : "fraca";
    el.className = "password-strength strength-" + level.replace(/[^\w-]/g, "");
    el.textContent = "Força da senha: " + level;
  }

  function setupPasswordToggle(inputEl, buttonEl) {
    if (!inputEl || !buttonEl) return;

    function syncLabel() {
      var hidden = inputEl.type === "password";
      buttonEl.textContent = hidden ? "👁" : "🙈";
      buttonEl.setAttribute("aria-label", hidden ? "Mostrar senha" : "Ocultar senha");
      buttonEl.setAttribute("title", hidden ? "Mostrar senha" : "Ocultar senha");
    }

    buttonEl.addEventListener("click", function () {
      inputEl.type = inputEl.type === "password" ? "text" : "password";
      syncLabel();
    });

    syncLabel();
  }

  function isEmailNotConfirmedError(message) {
    var text = String(message || "").toLowerCase();
    return (
      text.indexOf("email not confirmed") !== -1 ||
      text.indexOf("email_not_confirmed") !== -1 ||
      text.indexOf("confirm your email") !== -1 ||
      text.indexOf("confirme seu e-mail") !== -1
    );
  }

  function extractWaitSeconds(message) {
    var text = String(message || "");
    var match = text.match(/(\d+)\s*(s|sec|second|segundo)/i);
    if (!match) return null;
    var num = parseInt(match[1], 10);
    return isNaN(num) ? null : num;
  }

  function mapSupabaseError(error, fallbackMessage) {
    var raw = "";
    if (error && error.message) {
      raw = String(error.message);
    } else if (typeof error === "string") {
      raw = error;
    } else {
      raw = fallbackMessage || "Erro inesperado.";
    }

    var lower = raw.toLowerCase();

    if (
      lower.indexOf("already registered") !== -1 ||
      lower.indexOf("already been registered") !== -1 ||
      lower.indexOf("user already registered") !== -1
    ) {
      return "Este e-mail já possui uma conta. Faça login ou recupere sua senha.";
    }

    if (
      lower.indexOf("invalid login credentials") !== -1 ||
      lower.indexOf("invalid_credentials") !== -1
    ) {
      return "Credenciais inválidas.";
    }

    if (
      lower.indexOf("rate limit") !== -1 ||
      lower.indexOf("too many requests") !== -1 ||
      lower.indexOf("over_email_send_rate_limit") !== -1
    ) {
      var waitSeconds = extractWaitSeconds(raw);
      if (waitSeconds) {
        return "Muitas tentativas. Aguarde " + waitSeconds + " segundos antes de tentar novamente.";
      }
      return "Muitas tentativas. Aguarde alguns segundos antes de tentar novamente.";
    }

    if (
      lower.indexOf("network") !== -1 ||
      lower.indexOf("failed to fetch") !== -1
    ) {
      return "Erro de conexão. Verifique sua internet e tente novamente.";
    }

    return raw || fallbackMessage || "Erro inesperado.";
  }

  function createCooldown(seconds, onTick, onDone) {
    var remaining = Math.max(0, parseInt(seconds, 10) || 0);
    var timer = null;

    function stop() {
      if (timer) {
        global.clearInterval(timer);
        timer = null;
      }
    }

    if (typeof onTick === "function") {
      onTick(remaining);
    }

    if (remaining <= 0) {
      if (typeof onDone === "function") onDone();
      return {
        stop: stop,
        getRemaining: function () {
          return 0;
        },
      };
    }

    timer = global.setInterval(function () {
      remaining -= 1;
      if (typeof onTick === "function") {
        onTick(Math.max(remaining, 0));
      }
      if (remaining <= 0) {
        stop();
        if (typeof onDone === "function") onDone();
      }
    }, 1000);

    return {
      stop: stop,
      getRemaining: function () {
        return Math.max(remaining, 0);
      },
    };
  }

  function setFieldError(el, message) {
    if (!el) return;
    el.textContent = message || "";
  }

  function setStatus(el, message, type) {
    if (!el) return;
    el.className = "form-status " + (type ? "status-" + type : "");
    el.textContent = message || "";
  }

  global.MinutarioAuthUI = {
    DOMAIN: DOMAIN,
    buildInstitutionalEmail: buildInstitutionalEmail,
    validatePassword: validatePassword,
    getPasswordHint: getPasswordHint,
    setPasswordStrength: setPasswordStrength,
    setupPasswordToggle: setupPasswordToggle,
    isEmailNotConfirmedError: isEmailNotConfirmedError,
    mapSupabaseError: mapSupabaseError,
    createCooldown: createCooldown,
    setFieldError: setFieldError,
    setStatus: setStatus,
    extractIdentifier: extractIdentifier,
  };
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
