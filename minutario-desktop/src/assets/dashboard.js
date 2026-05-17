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
  var authUi = window.MinutarioAuthUI || {};
  var resendConfirmationEmail = "";
  var resendCooldown = null;
  var FONT_SIZE_VALUES = (window.MinutarioRichClipboard && window.MinutarioRichClipboard.FONT_SIZE_VALUES) || [
    "8pt",
    "9pt",
    "10pt",
    "11pt",
    "12pt",
    "14pt",
    "16pt",
    "18pt",
    "20pt",
    "24pt",
    "28pt",
    "32pt",
    "36pt",
    "48pt",
    "72pt",
  ];

  // DOM cache
  var els = {};

  function cacheElements() {
    els.loginScreen = document.getElementById("login-screen");
    els.dashboardScreen = document.getElementById("dashboard-screen");
    els.loginForm = document.getElementById("login-form");
    els.loginView = document.getElementById("login-view");
    els.signupView = document.getElementById("signup-view");
    els.forgotView = document.getElementById("forgot-view");
    els.resetView = document.getElementById("reset-view");
    els.loginEmail = document.getElementById("login-email-id");
    els.loginPassword = document.getElementById("login-password");
    els.loginEmailError = document.getElementById("login-email-error");
    els.loginStatus = document.getElementById("login-status");
    els.loginButton = document.getElementById("login-btn");
    els.goSignup = document.getElementById("go-signup");
    els.goForgot = document.getElementById("go-forgot");
    els.backToLoginFromSignup = document.getElementById("back-to-login-from-signup");
    els.backToLoginFromForgot = document.getElementById("back-to-login-from-forgot");
    els.signupForm = document.getElementById("signup-form");
    els.signupEmail = document.getElementById("signup-email-id");
    els.signupEmailError = document.getElementById("signup-email-error");
    els.signupPassword = document.getElementById("signup-password");
    els.signupPasswordConfirm = document.getElementById("signup-password-confirm");
    els.signupPasswordStrength = document.getElementById("signup-password-strength");
    els.signupPasswordError = document.getElementById("signup-password-error");
    els.signupConfirmError = document.getElementById("signup-confirm-error");
    els.signupStatus = document.getElementById("signup-status");
    els.signupSuccessBox = document.getElementById("signup-success-box");
    els.signupLgpdAccept = document.getElementById("signup-lgpd-accept");
    els.signupButton = document.getElementById("signup-btn");
    els.forgotForm = document.getElementById("forgot-form");
    els.forgotEmail = document.getElementById("forgot-email-id");
    els.forgotEmailError = document.getElementById("forgot-email-error");
    els.forgotStatus = document.getElementById("forgot-status");
    els.forgotButton = document.getElementById("forgot-btn");
    els.resetForm = document.getElementById("reset-form");
    els.resetNewPassword = document.getElementById("reset-new-password");
    els.resetConfirmPassword = document.getElementById("reset-confirm-password");
    els.resetPasswordStrength = document.getElementById("reset-password-strength");
    els.resetPasswordError = document.getElementById("reset-password-error");
    els.resetConfirmError = document.getElementById("reset-confirm-error");
    els.resetStatus = document.getElementById("reset-status");
    els.resetButton = document.getElementById("reset-btn");
    els.backToLoginFromReset = document.getElementById("back-to-login-from-reset");
    els.resendWrap = document.getElementById("resend-confirmation-wrap");
    els.resendButton = document.getElementById("resend-confirmation-btn");
    els.resendCountdown = document.getElementById("resend-countdown");
    els.logoutBtn = document.getElementById("logout-btn");
    els.searchInput = document.getElementById("search-input") || document.getElementById("search");
    els.templateList = document.getElementById("template-list");
    els.emptyState = document.getElementById("empty-state");
    els.syncBadge = document.getElementById("sync-badge");
    els.toast = document.getElementById("toast");
    els.importCsvInput = document.getElementById("import-csv");
    els.exportCsvBtn = document.getElementById("export-csv");
    els.supabaseSyncBtn = document.getElementById("supabase-sync");
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
    els.renameFolderBtn = document.getElementById("rename-folder");
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
    if (window.MinutarioRichClipboard && window.MinutarioRichClipboard.stripHtml) {
      return window.MinutarioRichClipboard.stripHtml(html);
    }
    if (!html) return "";
    var tmp = document.createElement("div");
    tmp.innerHTML = html;
    return tmp.textContent || tmp.innerText || "";
  }

  function getWordClipboardHtml(html) {
    if (window.MinutarioRichClipboard && window.MinutarioRichClipboard.buildOfficeHtml) {
      return window.MinutarioRichClipboard.buildOfficeHtml(html, document);
    }

    return [
      '<html xmlns:o="urn:schemas-microsoft-com:office:office"',
      ' xmlns:w="urn:schemas-microsoft-com:office:word"',
      ' xmlns="http://www.w3.org/TR/REC-html40">',
      '<head><meta charset="utf-8"></head><body>',
      html || "",
      "</body></html>",
    ].join("");
  }

  function getTemplateStorageHtml(html) {
    if (window.MinutarioRichClipboard && window.MinutarioRichClipboard.prepareHtmlFragment) {
      return window.MinutarioRichClipboard.prepareHtmlFragment(html, document);
    }

    return html || "";
  }

  function normalizeFontSize(value) {
    if (window.MinutarioRichClipboard && window.MinutarioRichClipboard.normalizeFontSize) {
      return window.MinutarioRichClipboard.normalizeFontSize(value);
    }

    var match = String(value || "").trim().match(/^(\d+(?:[.,]\d+)?)\s*(pt)?$/i);
    if (!match) return "";
    return match[1].replace(",", ".") + "pt";
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

  // Custom modal dialogs (replaces native prompt/confirm which don't work in Tauri)
  var _modalOpen = false;

  function forceBlurEditor() {
    if (quill && typeof quill.blur === "function") {
      quill.blur();
    }
    if (document.activeElement && document.activeElement !== document.body) {
      document.activeElement.blur();
    }
  }

  function createModalFocusLock(overlay, preferredElement, shouldSelectText) {
    var released = false;
    var focusInterval = null;
    var didInitialSelect = false;
    var suppressRedirect = false;

    function focusPreferred() {
      if (!preferredElement || !preferredElement.isConnected) return;
      if (document.activeElement === preferredElement) return;
      preferredElement.focus();
      if (shouldSelectText && !didInitialSelect && typeof preferredElement.select === "function") {
        preferredElement.select();
        didInitialSelect = true;
      }
    }

    function onDocumentKeydown(event) {
      var targetInOverlay = overlay.contains(event.target) || (event.composedPath && function() {
        var path = event.composedPath();
        for (var i = 0; i < path.length; i++) {
          if (path[i] === overlay) return true;
        }
        return false;
      }());
      var activeInOverlay = overlay.contains(document.activeElement);
      if (!targetInOverlay && !activeInOverlay) {
        event.preventDefault();
        event.stopPropagation();
        focusPreferred();
      }
    }

    function onDocumentFocusIn(event) {
      if (suppressRedirect) return;
      if (!overlay.contains(event.target) && !overlay.contains(document.activeElement)) {
        event.stopPropagation();
        focusPreferred();
      }
    }

    var editorWasEnabled = false;
    if (typeof window.quill !== "undefined" && window.quill) {
      var quill = window.quill;
      if (typeof quill.isEnabled === "function" && typeof quill.enable === "function") {
        editorWasEnabled = quill.isEnabled();
        if (editorWasEnabled) {
          quill.enable(false);
        }
      }
    }

    document.body.classList.add("modal-open");

    document.addEventListener("focusin", onDocumentFocusIn, true);
    document.addEventListener("keydown", onDocumentKeydown, true);

    focusInterval = window.setInterval(function() {
      if (!_modalOpen || !preferredElement || !preferredElement.isConnected) return;
      if (document.activeElement !== preferredElement && !overlay.contains(document.activeElement)) {
        focusPreferred();
      }
    }, 500);

    focusPreferred();

    return {
      release: function releaseModalFocusLock() {
        if (released) return;
        released = true;
        if (focusInterval) {
          window.clearInterval(focusInterval);
          focusInterval = null;
        }
        document.removeEventListener("focusin", onDocumentFocusIn, true);
        document.removeEventListener("keydown", onDocumentKeydown, true);
        document.body.classList.remove("modal-open");
        if (editorWasEnabled && typeof window.quill !== "undefined" && typeof window.quill.enable === "function") {
          window.quill.enable(true);
        }
      },
      setSuppressRedirect: function(v) { suppressRedirect = !!v; }
    };
  }

  function showInputModal(title, defaultValue) {
    return new Promise(function(resolve) {
      _modalOpen = true;
      forceBlurEditor();

      var overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      var box = document.createElement("div");
      box.className = "modal-box";

      var heading = document.createElement("h3");
      heading.className = "modal-title";
      heading.textContent = title || "";

      var input = document.createElement("input");
      input.className = "modal-input";
      input.type = "text";
      input.value = defaultValue || "";

      var actions = document.createElement("div");
      actions.className = "modal-actions";

      var cancelBtn = document.createElement("button");
      cancelBtn.className = "btn btn-secondary";
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancelar";

      var okBtn = document.createElement("button");
      okBtn.className = "btn btn-primary";
      okBtn.type = "button";
      okBtn.textContent = "OK";

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      box.appendChild(heading);
      box.appendChild(input);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      var focusLock = createModalFocusLock(overlay, input, true);

      var _userClickedInput = false;

      input.addEventListener("mousedown", function(e) {
        _userClickedInput = true;
        focusLock.setSuppressRedirect(true);
        e.stopPropagation();
        if (document.activeElement !== input) {
          input.focus();
        }
      });

      input.addEventListener("mouseup", function() {
        if (document.activeElement !== input && input.isConnected) {
          input.focus();
        }
      });

      input.addEventListener("click", function() {
        if (document.activeElement !== input && input.isConnected) {
          input.focus();
        }
        _userClickedInput = false;
        window.setTimeout(function() { focusLock.setSuppressRedirect(false); }, 100);
      });

      // Clicking on non-interactive areas inside the box (heading, padding)
      // should redirect focus to the input.
      box.addEventListener("mousedown", function(e) {
        if (e.target === input || e.target.tagName === "BUTTON") return;
        e.preventDefault();
        input.focus();
      });

      function cleanup(result) {
        _modalOpen = false;
        focusLock.release();
        overlay.remove();
        resolve(result);
      }

      okBtn.addEventListener("click", function() {
        cleanup(input.value);
      });

      cancelBtn.addEventListener("click", function() {
        cleanup(null);
      });

      // Handle Enter/Escape on the input itself (NOT capture phase on overlay)
      input.addEventListener("keydown", function(e) {
        e.stopPropagation(); // prevent global handleKeydown from firing
        if (e.key === "Enter") {
          e.preventDefault();
          cleanup(input.value);
        } else if (e.key === "Escape") {
          e.preventDefault();
          cleanup(null);
        }
      });

      // Prevent clicks on overlay background from focusing elements behind it
      overlay.addEventListener("mousedown", function(e) {
        if (e.target === overlay) {
          e.preventDefault();
          cleanup(null);
        }
      });

      overlay.addEventListener("click", function(e) {
        if (e.target === overlay) e.preventDefault();
      });

      // FIX: Use guarded focus calls to avoid redundant focus() in WebView2,
      // which silently drops keystrokes when focus is called on an already-
      // focused element (see focusPreferred guard comment above).
      window.setTimeout(function() {
        if (!_modalOpen || !input.isConnected) return;
        if (document.activeElement !== input) {
          input.focus();
        }
        if (typeof input.select === "function") input.select();
      }, 50);
      window.setTimeout(function() {
        if (!_modalOpen || !input.isConnected) return;
        if (document.activeElement !== input) {
          input.focus();
        }
      }, 200);
    });
  }

  function showConfirmModal(message) {
    return new Promise(function(resolve) {
      _modalOpen = true;
      forceBlurEditor();

      var overlay = document.createElement("div");
      overlay.className = "modal-overlay";

      var box = document.createElement("div");
      box.className = "modal-box";

      var msg = document.createElement("p");
      msg.className = "modal-message";
      msg.textContent = message || "";

      var actions = document.createElement("div");
      actions.className = "modal-actions";

      var cancelBtn = document.createElement("button");
      cancelBtn.className = "btn btn-secondary";
      cancelBtn.type = "button";
      cancelBtn.textContent = "Cancelar";

      var okBtn = document.createElement("button");
      okBtn.className = "btn btn-danger";
      okBtn.type = "button";
      okBtn.textContent = "Confirmar";

      actions.appendChild(cancelBtn);
      actions.appendChild(okBtn);
      box.appendChild(msg);
      box.appendChild(actions);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
      var focusLock = createModalFocusLock(overlay, okBtn, false);

      function cleanup(result) {
        _modalOpen = false;
        focusLock.release();
        overlay.remove();
        resolve(result);
      }

      okBtn.addEventListener("click", function() {
        cleanup(true);
      });

      cancelBtn.addEventListener("click", function() {
        cleanup(false);
      });

      // Escape on buttons (bubble phase, NOT capture)
      okBtn.addEventListener("keydown", function(e) {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); cleanup(false); }
      });
      cancelBtn.addEventListener("keydown", function(e) {
        e.stopPropagation();
        if (e.key === "Escape") { e.preventDefault(); cleanup(false); }
      });

      overlay.addEventListener("mousedown", function(e) {
        if (e.target === overlay) { e.preventDefault(); cleanup(false); }
      });

      window.setTimeout(function() {
        if (!_modalOpen || !okBtn.isConnected) return;
        if (document.activeElement !== okBtn) okBtn.focus();
      }, 50);
    });
  }

  function debugLog(message, details) {
    var config = window.MinutarioConfig || {};
    if (!config.DEBUG_LOGS || !window.console || typeof window.console.log !== "function") {
      return;
    }

    if (typeof details === "undefined") {
      window.console.log("[MinutarioDashboard] " + message);
      return;
    }

    window.console.log("[MinutarioDashboard] " + message, details);
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
    return Promise.resolve();
  }

  // Auth helpers
  function getTauriInvoke() {
    return window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke
      ? window.__TAURI__.core.invoke
      : null;
  }

  function setFieldError(el, message) {
    if (authUi.setFieldError) {
      authUi.setFieldError(el, message);
      return;
    }
    if (el) {
      el.textContent = message || "";
    }
  }

  function setFormStatus(el, message, type) {
    if (authUi.setStatus) {
      authUi.setStatus(el, message, type || "");
      return;
    }
    if (el) {
      el.textContent = message || "";
    }
  }

  function clearAuthMessages() {
    setFieldError(els.loginEmailError, "");
    setFieldError(els.signupEmailError, "");
    setFieldError(els.signupPasswordError, "");
    setFieldError(els.signupConfirmError, "");
    setFieldError(els.forgotEmailError, "");
    setFieldError(els.resetPasswordError, "");
    setFieldError(els.resetConfirmError, "");
    setFormStatus(els.loginStatus, "");
    setFormStatus(els.signupStatus, "");
    setFormStatus(els.forgotStatus, "");
    setFormStatus(els.resetStatus, "");
  }

  function showAuthView(name) {
    clearAuthMessages();
    if (els.signupSuccessBox) {
      els.signupSuccessBox.classList.add("hidden");
      els.signupSuccessBox.textContent = "";
    }
    if (els.loginView) els.loginView.classList.add("hidden");
    if (els.signupView) els.signupView.classList.add("hidden");
    if (els.forgotView) els.forgotView.classList.add("hidden");
    if (els.resetView) els.resetView.classList.add("hidden");

    if (name === "signup" && els.signupView) {
      els.signupView.classList.remove("hidden");
    } else if (name === "forgot" && els.forgotView) {
      els.forgotView.classList.remove("hidden");
    } else if (name === "reset" && els.resetView) {
      els.resetView.classList.remove("hidden");
    } else if (els.loginView) {
      els.loginView.classList.remove("hidden");
    }
  }

  function setSubmitLoading(buttonEl, loading, label) {
    var textEl;
    var defaultLabel;
    var spinnerEl;

    if (!buttonEl) return;
    textEl = buttonEl.querySelector(".btn-text");
    defaultLabel = buttonEl.dataset.defaultLabel || (textEl ? textEl.textContent : buttonEl.textContent);
    buttonEl.dataset.defaultLabel = defaultLabel;

    if (loading) {
      buttonEl.disabled = true;
      if (textEl) {
        textEl.textContent = label || "Processando...";
      } else {
        buttonEl.textContent = label || "Processando...";
      }
      spinnerEl = buttonEl.querySelector(".spinner");
      if (!spinnerEl) {
        spinnerEl = document.createElement("span");
        spinnerEl.className = "spinner";
        if (buttonEl.querySelector(".auth-submit-content")) {
          buttonEl.querySelector(".auth-submit-content").appendChild(spinnerEl);
        } else {
          buttonEl.appendChild(spinnerEl);
        }
      }
      return;
    }

    if (textEl) {
      textEl.textContent = defaultLabel;
    } else {
      buttonEl.textContent = defaultLabel;
    }

    spinnerEl = buttonEl.querySelector(".spinner");
    if (spinnerEl) spinnerEl.remove();

    if (buttonEl !== els.signupButton || !els.signupLgpdAccept || els.signupLgpdAccept.checked) {
      buttonEl.disabled = false;
    }
  }

  function getConfirmationRedirectUrl() {
    var config = window.MinutarioConfig || {};
    if (config.EMAIL_CONFIRMATION_REDIRECT_URL) {
      return config.EMAIL_CONFIRMATION_REDIRECT_URL;
    }
    return "tauri://localhost/confirmed";
  }

  function getPasswordResetRedirectUrl() {
    var config = window.MinutarioConfig || {};
    if (config.PASSWORD_RESET_DESKTOP_REDIRECT_URL) {
      return config.PASSWORD_RESET_DESKTOP_REDIRECT_URL;
    }
    if (config.PASSWORD_RESET_REDIRECT_URL) {
      return config.PASSWORD_RESET_REDIRECT_URL;
    }
    return "tauri://localhost/password-reset";
  }

  function showResendConfirmation() {
    if (els.resendWrap) els.resendWrap.classList.remove("hidden");
    if (els.resendButton) els.resendButton.disabled = false;
    if (els.resendCountdown) els.resendCountdown.textContent = "";
  }

  function hideResendConfirmation() {
    if (els.resendWrap) els.resendWrap.classList.add("hidden");
    if (resendCooldown && resendCooldown.stop) {
      resendCooldown.stop();
    }
    resendCooldown = null;
  }

  function startResendCooldown(seconds) {
    if (resendCooldown && resendCooldown.stop) {
      resendCooldown.stop();
    }

    if (!authUi.createCooldown) {
      return;
    }

    resendCooldown = authUi.createCooldown(
      seconds,
      function (remaining) {
        if (els.resendCountdown) {
          els.resendCountdown.textContent = remaining > 0 ? "Aguarde " + remaining + "s para reenviar." : "";
        }
        if (els.resendButton) {
          els.resendButton.disabled = remaining > 0;
        }
      },
      function () {
        if (els.resendCountdown) els.resendCountdown.textContent = "";
        if (els.resendButton) els.resendButton.disabled = false;
      }
    );
  }

  function updateSignupPasswordFeedback() {
    var validation;
    if (!els.signupPassword) return null;
    validation = authUi.validatePassword ? authUi.validatePassword(els.signupPassword.value) : null;
    if (authUi.setPasswordStrength) {
      authUi.setPasswordStrength(els.signupPasswordStrength, validation);
    }
    if (authUi.getPasswordHint) {
      setFieldError(els.signupPasswordError, authUi.getPasswordHint(validation));
    }
    updateSignupConfirmFeedback();
    return validation;
  }

  function updateSignupConfirmFeedback() {
    if (!els.signupPassword || !els.signupPasswordConfirm) return;
    if (!els.signupPasswordConfirm.value) {
      setFieldError(els.signupConfirmError, "");
      return;
    }
    if (els.signupPassword.value !== els.signupPasswordConfirm.value) {
      setFieldError(els.signupConfirmError, "As senhas não coincidem.");
      return;
    }
    setFieldError(els.signupConfirmError, "");
  }

  function updateResetPasswordFeedback() {
    var validation;
    if (!els.resetNewPassword) return null;
    validation = authUi.validatePassword ? authUi.validatePassword(els.resetNewPassword.value) : null;
    if (authUi.setPasswordStrength) {
      authUi.setPasswordStrength(els.resetPasswordStrength, validation);
    }
    if (authUi.getPasswordHint) {
      setFieldError(els.resetPasswordError, authUi.getPasswordHint(validation));
    }
    updateResetConfirmFeedback();
    return validation;
  }

  function updateResetConfirmFeedback() {
    if (!els.resetNewPassword || !els.resetConfirmPassword) return;
    if (!els.resetConfirmPassword.value) {
      setFieldError(els.resetConfirmError, "");
      return;
    }
    if (els.resetNewPassword.value !== els.resetConfirmPassword.value) {
      setFieldError(els.resetConfirmError, "As senhas não coincidem.");
      return;
    }
    setFieldError(els.resetConfirmError, "");
  }

  async function signInWithSupabaseJs(email, password) {
    var client = window.MinutarioAPI.getClient();
    if (!client || !client.auth || !client.auth.signInWithPassword) {
      throw new Error("Cliente Supabase não disponível");
    }

    var result = await client.auth.signInWithPassword({ email: email, password: password });
    if (result.error) {
      throw result.error;
    }

    if (!result.data || !result.data.session) {
      throw new Error("Sessão não retornada pelo Supabase");
    }

    return result.data;
  }

  async function signInWithTauriAuth(email, password) {
    var invoke = getTauriInvoke();
    var config = window.MinutarioConfig || {};

    if (!invoke) {
      throw new Error("Tauri invoke não disponível");
    }

    var response = await invoke("supabase_password_login", {
      supabaseUrl: config.SUPABASE_URL || "",
      anonKey: config.SUPABASE_ANON_KEY || "",
      email: email,
      password: password,
    });

    if (!response || !response.access_token || !response.refresh_token) {
      throw new Error("Sessão não retornada pelo Supabase");
    }

    return {
      session: {
        access_token: response.access_token,
        refresh_token: response.refresh_token,
        expires_in: response.expires_in,
        expires_at: response.expires_at,
        token_type: response.token_type || "bearer",
        user: response.user,
      },
      user: response.user,
    };
  }

  async function authenticate(email, password) {
    var primaryError = null;

    try {
      return await signInWithSupabaseJs(email, password);
    } catch (err) {
      primaryError = err;
      debugLog("Supabase JS login failed; trying Tauri backend fallback.", {
        error: err && err.message ? err.message : String(err),
      });
    }

    try {
      return await signInWithTauriAuth(email, password);
    } catch (fallbackErr) {
      debugLog("Tauri backend login fallback failed.", {
        primaryError: primaryError && primaryError.message ? primaryError.message : String(primaryError),
        fallbackError: fallbackErr && fallbackErr.message ? fallbackErr.message : String(fallbackErr),
      });
      throw fallbackErr || primaryError;
    }
  }

  async function saveTokens(session) {
    if (window.MinutarioAPI && window.MinutarioAPI.saveAuthSession) {
      await window.MinutarioAPI.saveAuthSession(session);
    }
  }

  async function clearTokens() {
    localStorage.removeItem("minutario_user_id");
    if (window.MinutarioAPI && window.MinutarioAPI.clearAuthSession) {
      await window.MinutarioAPI.clearAuthSession();
    }
  }

function getUserIdFromUser(user) {
    return (user && user.id) || null;
  }

  async function getStoredUserId() {
    var storedUserId = localStorage.getItem("minutario_user_id");
    if (storedUserId) return storedUserId;
    return null;
  }

  async function saveUserId(value) {
    if (!value) return;

    var previousUserId = await getStoredUserId();

    if (window.MinutarioSync && window.MinutarioSync.prepareUserContext) {
      await window.MinutarioSync.prepareUserContext(value, previousUserId);
    }

    userId = value;
    localStorage.setItem("minutario_user_id", value);

    if (window.MinutarioDB && window.MinutarioDB.setMeta) {
      try { await window.MinutarioDB.setMeta("minutario_user_id", value); } catch (e) {}
    }
  }

  // Screen management
  function showLoginScreen() {
    document.body.classList.remove("dashboard-mode");
    if (els.loginScreen) els.loginScreen.classList.remove("hidden");
    if (els.dashboardScreen) els.dashboardScreen.classList.add("hidden");
    hideResendConfirmation();
    showAuthView("login");
  }

  function showDashboardScreen() {
    document.body.classList.add("dashboard-mode");
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
    if (els.renameFolderBtn) {
      els.renameFolderBtn.disabled = !activeFolderId;
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
        allFolders = allFolders.filter(function(folder) {
          return !userId || !folder.user_id || folder.user_id === userId;
        });
      } else {
        allFolders = [];
      }
      populateFolderSelect();
      renderFolderList();
      if (els.deleteFolderBtn) {
        els.deleteFolderBtn.disabled = !activeFolderId;
      }
      if (els.renameFolderBtn) {
        els.renameFolderBtn.disabled = !activeFolderId;
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
    var emailData = authUi.buildInstitutionalEmail ? authUi.buildInstitutionalEmail(els.loginEmail ? els.loginEmail.value : "") : { ok: true, email: (els.loginEmail ? els.loginEmail.value.trim() : "") };
    var password = els.loginPassword ? els.loginPassword.value : "";
    var authData = null;

    clearAuthMessages();
    hideResendConfirmation();

    if (!emailData.ok) {
      setFieldError(els.loginEmailError, emailData.error || "E-mail inválido.");
      return;
    }

    if (!password) {
      setFormStatus(els.loginStatus, "Informe sua senha.", "error");
      return;
    }

    setSubmitLoading(els.loginButton, true, "Entrando...");

    try {
      authData = await authenticate(emailData.email, password);
    } catch (err) {
      var loginErrorMessage = authUi.mapSupabaseError
        ? authUi.mapSupabaseError(err, "Erro ao autenticar no Supabase.")
        : (err && err.message ? err.message : "Erro ao autenticar no Supabase.");
      if (authUi.isEmailNotConfirmedError && authUi.isEmailNotConfirmedError(err && err.message ? err.message : "")) {
        var unconfirmedMessage = authUi.getEmailNotConfirmedMessage
          ? authUi.getEmailNotConfirmedMessage()
          : "Seu e-mail ainda não foi confirmado. Verifique sua caixa de entrada ou clique aqui para reenviar o e-mail de confirmação.";
        setFormStatus(els.loginStatus, unconfirmedMessage, "error");
        resendConfirmationEmail = emailData.email;
        showResendConfirmation();
      } else {
        setFormStatus(els.loginStatus, loginErrorMessage, "error");
      }
      setSubmitLoading(els.loginButton, false);
      return;
    }

    try {
      var session = authData.session;
      var user = authData.user || session.user;

      await saveTokens(session);
      resendConfirmationEmail = emailData.email;

      await saveUserId(getUserIdFromUser(user));

      setFormStatus(els.loginStatus, "", "");
      await initDashboard();
    } catch (err) {
      console.error("Post-login init failed:", err);
      setFormStatus(els.loginStatus, "Login feito, mas falhou ao carregar dados locais/sync: " + (err.message || err), "error");
    } finally {
      setSubmitLoading(els.loginButton, false);
    }
  }

  async function handleSignup(event) {
    event.preventDefault();
    clearAuthMessages();

    var emailData = authUi.buildInstitutionalEmail ? authUi.buildInstitutionalEmail(els.signupEmail ? els.signupEmail.value : "") : { ok: true, email: (els.signupEmail ? els.signupEmail.value.trim() : "") };
    var passwordValidation = updateSignupPasswordFeedback();

    if (!emailData.ok) {
      setFieldError(els.signupEmailError, emailData.error || "E-mail inválido.");
      return;
    }

    if (!passwordValidation || !passwordValidation.valid) {
      setFieldError(els.signupPasswordError, authUi.getPasswordHint ? authUi.getPasswordHint(passwordValidation) : "Senha fraca.");
      return;
    }

    if (!els.signupPassword || !els.signupPasswordConfirm || els.signupPassword.value !== els.signupPasswordConfirm.value) {
      setFieldError(els.signupConfirmError, "As senhas não coincidem.");
      return;
    }

    if (!els.signupLgpdAccept || !els.signupLgpdAccept.checked) {
      setFormStatus(els.signupStatus, "Para continuar, aceite os Termos de Uso e a Política de Privacidade.", "error");
      return;
    }

    setSubmitLoading(els.signupButton, true, "Criando conta...");

    try {
      var client = window.MinutarioAPI.getClient();
      if (!client) throw new Error("Cliente Supabase não disponível");

      var result = await client.auth.signUp({
        email: emailData.email,
        password: els.signupPassword.value,
        options: {
          emailRedirectTo: getConfirmationRedirectUrl(),
        },
      });

      if (result.error) throw result.error;

      resendConfirmationEmail = emailData.email;
      if (els.signupSuccessBox) {
        els.signupSuccessBox.classList.remove("hidden");
        els.signupSuccessBox.textContent =
          "Conta criada com sucesso! Enviamos um e-mail de confirmação para " +
          emailData.email +
          ". Acesse seu e-mail institucional do TJPR e clique no link de confirmação para ativar sua conta.";
      }
      setFormStatus(els.signupStatus, "Cadastro concluído. Retornando ao login...", "success");
      if (els.loginEmail) els.loginEmail.value = emailData.identifier || "";
      showAuthView("login");
      setFormStatus(els.loginStatus, "Seu cadastro foi criado. Confirme o e-mail para entrar.", "success");
    } catch (err) {
      var signupErrorMessage = authUi.mapSupabaseError
        ? authUi.mapSupabaseError(err, "Erro ao criar conta.")
        : (err && err.message ? err.message : "Erro ao criar conta.");
      setFormStatus(els.signupStatus, signupErrorMessage, "error");
    } finally {
      setSubmitLoading(els.signupButton, false);
    }
  }

  async function handleForgotPassword(event) {
    event.preventDefault();
    clearAuthMessages();

    var emailData = authUi.buildInstitutionalEmail ? authUi.buildInstitutionalEmail(els.forgotEmail ? els.forgotEmail.value : "") : { ok: true, email: (els.forgotEmail ? els.forgotEmail.value.trim() : "") };
    if (!emailData.ok) {
      setFieldError(els.forgotEmailError, emailData.error || "E-mail inválido.");
      return;
    }

    setSubmitLoading(els.forgotButton, true, "Enviando...");

    try {
      var client = window.MinutarioAPI.getClient();
      if (!client) throw new Error("Cliente Supabase não disponível");
      var result = await client.auth.resetPasswordForEmail(emailData.email, {
        redirectTo: getPasswordResetRedirectUrl(),
      });
      if (result.error) throw result.error;
      setFormStatus(
        els.forgotStatus,
        "Se o e-mail informado estiver cadastrado, você receberá um link para redefinição de senha.",
        "success"
      );
    } catch (err) {
      var forgotMessage = authUi.mapSupabaseError
        ? authUi.mapSupabaseError(err, "Erro ao solicitar redefinição.")
        : (err && err.message ? err.message : "Erro ao solicitar redefinição.");
      setFormStatus(els.forgotStatus, forgotMessage, "error");
    } finally {
      setSubmitLoading(els.forgotButton, false);
    }
  }

  async function handleResendConfirmation() {
    if (!resendConfirmationEmail) {
      setFormStatus(els.loginStatus, "Informe seu e-mail e tente novamente.", "error");
      return;
    }

    if (els.resendButton) els.resendButton.disabled = true;
    if (els.resendCountdown) els.resendCountdown.textContent = "Enviando...";

    try {
      var client = window.MinutarioAPI.getClient();
      if (!client || !client.auth || typeof client.auth.resend !== "function") {
        throw new Error("Reenvio de confirmação não disponível.");
      }
      var result = await client.auth.resend({
        type: "signup",
        email: resendConfirmationEmail,
        options: { emailRedirectTo: getConfirmationRedirectUrl() },
      });
      if (result.error) throw result.error;
      setFormStatus(els.loginStatus, "E-mail de confirmação reenviado com sucesso.", "success");
      startResendCooldown(60);
    } catch (err) {
      var resendMessage = authUi.mapSupabaseError
        ? authUi.mapSupabaseError(err, "Falha ao reenviar confirmação.")
        : (err && err.message ? err.message : "Falha ao reenviar confirmação.");
      setFormStatus(els.loginStatus, resendMessage, "error");
      if (els.resendButton) els.resendButton.disabled = false;
      if (els.resendCountdown) els.resendCountdown.textContent = "";
    }
  }

  async function restoreRecoverySessionFromUrl(urlValue) {
    var url;
    var code;
    var hashParams;
    var accessToken;
    var refreshToken;
    var client = window.MinutarioAPI.getClient();

    if (!client || !client.auth) {
      throw new Error("Cliente Supabase não disponível");
    }

    url = new URL(String(urlValue || ""));
    code = url.searchParams.get("code");
    hashParams = new URLSearchParams(url.hash ? url.hash.replace(/^#/, "") : "");
    accessToken = hashParams.get("access_token");
    refreshToken = hashParams.get("refresh_token");

    if (code && client.auth.exchangeCodeForSession) {
      var codeResult = await client.auth.exchangeCodeForSession(code);
      if (codeResult.error) throw codeResult.error;
      if (codeResult.data && codeResult.data.session && window.MinutarioAPI.saveAuthSession) {
        await window.MinutarioAPI.saveAuthSession(codeResult.data.session);
      }
      return;
    }

    if (accessToken && refreshToken) {
      var sessionResult = await client.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionResult.error) throw sessionResult.error;
      if (sessionResult.data && sessionResult.data.session && window.MinutarioAPI.saveAuthSession) {
        await window.MinutarioAPI.saveAuthSession(sessionResult.data.session);
      }
      return;
    }

    throw new Error("Link de redefinição inválido.");
  }

  async function handleResetPassword(event) {
    event.preventDefault();
    clearAuthMessages();

    var validation = updateResetPasswordFeedback();
    if (!validation || !validation.valid) {
      setFormStatus(els.resetStatus, "Senha fraca. Ajuste os critérios obrigatórios.", "error");
      return;
    }

    if (!els.resetNewPassword || !els.resetConfirmPassword || els.resetNewPassword.value !== els.resetConfirmPassword.value) {
      setFieldError(els.resetConfirmError, "As senhas não coincidem.");
      setFormStatus(els.resetStatus, "As senhas não coincidem.", "error");
      return;
    }

    setSubmitLoading(els.resetButton, true, "Salvando...");

    try {
      var client = window.MinutarioAPI.getClient();
      var result = await client.auth.updateUser({ password: els.resetNewPassword.value });
      if (result.error) throw result.error;
      setFormStatus(els.resetStatus, "Senha atualizada com sucesso. Faça login novamente.", "success");
      if (els.resetForm) els.resetForm.reset();
      updateResetPasswordFeedback();
      showAuthView("login");
      setFormStatus(els.loginStatus, "Senha redefinida com sucesso. Faça login.", "success");
    } catch (err) {
      var resetMessage = authUi.mapSupabaseError
        ? authUi.mapSupabaseError(err, "Erro ao atualizar senha.")
        : (err && err.message ? err.message : "Erro ao atualizar senha.");
      setFormStatus(els.resetStatus, resetMessage, "error");
    } finally {
      setSubmitLoading(els.resetButton, false);
    }
  }

  async function consumeDeepLinkIfAny() {
    var invoke = getTauriInvoke();
    var pendingUrl = null;

    if (!invoke) return;

    try {
      pendingUrl = await invoke("consume_pending_deep_link");
    } catch (err) {
      pendingUrl = null;
    }

    if (!pendingUrl) return;

    if (String(pendingUrl).indexOf("/confirmed") !== -1) {
      showAuthView("login");
      setFormStatus(els.loginStatus, "E-mail confirmado com sucesso. Faça login para continuar.", "success");
      return;
    }

    if (String(pendingUrl).indexOf("/password-reset") !== -1) {
      showAuthView("reset");
      try {
        await restoreRecoverySessionFromUrl(pendingUrl);
        setFormStatus(els.resetStatus, "Digite e confirme sua nova senha.", "success");
      } catch (err) {
        setFormStatus(els.resetStatus, "Link expirado. Solicite novo e-mail de redefinição.", "error");
      }
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

    await clearTokens();
    await window.MinutarioDB.deleteAllTemplates();
    if (window.MinutarioDB.deleteAllFolders) {
      await window.MinutarioDB.deleteAllFolders();
    }

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
      if (userId && window.MinutarioSync && window.MinutarioSync.syncTemplates) {
        var syncResult = await window.MinutarioSync.syncTemplates(userId);
        if (syncResult && syncResult.success) {
          allTemplates = await window.MinutarioDB.getAllTemplates();
          allTemplates = allTemplates.filter(function(template) {
            return !template.user_id || template.user_id === userId;
          });
          setImportStatus(
            "Sync concluído: " +
              (syncResult.count || allTemplates.length || 0) +
              " templates, " +
              (syncResult.folderCount || 0) +
              " pastas."
          );
          filterAndRender();
          return;
        }

        var syncError = syncResult && syncResult.error ? syncResult.error : "Erro ao sincronizar";
        setImportStatus(syncError, true);
        showToast(syncError);
        updateSyncBadge("error");
      }

      var localTemplates = await window.MinutarioDB.getAllTemplates();
      allTemplates = localTemplates.filter(function(template) {
        return !userId || !template.user_id || template.user_id === userId;
      });
      setImportStatus("Usando dados locais: " + allTemplates.length + " templates.");
      filterAndRender();
    } catch (err) {
      console.error("Load templates error:", err);
      showToast("Erro ao carregar templates");
    }
  }

  async function handleForceSync() {
    try {
      if (!userId) {
        userId = await getStoredUserId();
      }

      if (!userId || !window.MinutarioSync || !window.MinutarioSync.syncTemplates) {
        throw new Error("Usuário ou módulo de sync indisponível");
      }

      updateSyncBadge("syncing");
      var result = await window.MinutarioSync.syncTemplates(userId, { forceFullPull: true });

      if (!result || !result.success) {
        throw new Error(result && result.error ? result.error : "Erro ao sincronizar");
      }

      await loadFolders();
      allTemplates = await window.MinutarioDB.getAllTemplates();
      allTemplates = allTemplates.filter(function(template) {
        return !template.user_id || template.user_id === userId;
      });
      filterAndRender();
      updateSyncBadge("updated");
      showToast("Sincronizado com sucesso");
    } catch (err) {
      console.error("Force sync error:", err);
      updateSyncBadge("error");
      showToast(err && err.message ? err.message : "Erro ao sincronizar");
    }
  }

  async function syncAfterMutation(reason) {
    if (!userId || !window.MinutarioSync) {
      return { success: false, error: "Usuário ou módulo de sync indisponível" };
    }

    updateSyncBadge("syncing");
    debugLog("Scheduling automatic sync.", { userId: userId, reason: reason });

    var syncFn = window.MinutarioSync.flushAutoSync || window.MinutarioSync.syncTemplates;
    var result = await syncFn(userId, reason);

    if (!result || !result.success) {
      updateSyncBadge("offline");
      showToast("Alteração salva localmente. Sincronização pendente.");
      return result || { success: false, error: "Erro ao sincronizar" };
    }

    updateSyncBadge("updated");
    return result;
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

    try {
      if (window.MinutarioRichClipboard && window.MinutarioRichClipboard.copyRichText && htmlContent) {
        await window.MinutarioRichClipboard.copyRichText(htmlContent, plainText || stripHtml(htmlContent), {
          document: document,
          navigator: navigator,
          ClipboardItem: window.ClipboardItem,
          Blob: window.Blob,
        });
      } else if (navigator.clipboard && navigator.clipboard.write && htmlContent && typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([getWordClipboardHtml(htmlContent)], { type: "text/html" }),
            "text/plain": new Blob([plainText || stripHtml(htmlContent)], { type: "text/plain" })
          })
        ]);
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
  function registerFontSizeAttributor() {
    if (window.MinutarioRichClipboard && window.MinutarioRichClipboard.registerQuillFontSize) {
      window.MinutarioRichClipboard.registerQuillFontSize(window.Quill);
    }
  }

  function getEditorToolbarElement() {
    if (!els.quillEditor || !els.quillEditor.parentNode) {
      return null;
    }

    return els.quillEditor.parentNode.querySelector(".ql-toolbar");
  }

  function ensureSizeSelectOption(select, value) {
    var exists = false;

    if (!select || !value) {
      return;
    }

    Array.prototype.forEach.call(select.options || [], function(option) {
      if (option.value === value) {
        exists = true;
      }
    });

    if (!exists) {
      var option = document.createElement("option");
      option.value = value;
      option.textContent = value.replace(/pt$/, "");
      select.appendChild(option);
    }
  }

  function applyFontSize(value) {
    var normalized = normalizeFontSize(value);
    var range;

    if (!quill || !normalized) {
      return;
    }

    if (window.MinutarioRichClipboard && window.MinutarioRichClipboard.ensureQuillFontSizeValue) {
      window.MinutarioRichClipboard.ensureQuillFontSizeValue(window.Quill, normalized);
    }

    range = quill.getSelection ? quill.getSelection(true) : null;
    if (range && typeof quill.formatText === "function" && range.length > 0) {
      quill.formatText(range.index, range.length, "size", normalized, "user");
      if (typeof quill.setSelection === "function") {
        quill.setSelection(range.index, range.length, "silent");
      }
    } else if (typeof quill.format === "function") {
      quill.format("size", normalized, "user");
    }

    updateFontSizeToolbar();
  }

  function updateFontSizeToolbar() {
    var toolbar = getEditorToolbarElement();
    var select = toolbar ? toolbar.querySelector("select.ql-size") : null;
    var manualInput = toolbar ? toolbar.querySelector(".ql-font-size-manual") : null;
    var range = quill && quill.getSelection ? quill.getSelection() : null;
    var format = {};
    var size = "";

    if (!toolbar || !quill || !quill.getFormat) {
      return;
    }

    if (range) {
      format = quill.getFormat(range.index, range.length);
    } else {
      format = quill.getFormat();
    }

    size = normalizeFontSize(format && format.size ? format.size : "");

    if (select) {
      ensureSizeSelectOption(select, size);
      select.value = size || "";
    }

    if (manualInput) {
      manualInput.value = size ? size.replace(/pt$/, "") : "";
    }
  }

  function setupFontSizeToolbar() {
    var toolbar = getEditorToolbarElement();
    var select = toolbar ? toolbar.querySelector("select.ql-size") : null;
    var group;
    var input;
    var suffix;

    if (!toolbar || toolbar.querySelector(".ql-font-size-manual")) {
      return;
    }

    if (select) {
      Array.prototype.forEach.call(select.options || [], function(option) {
        option.textContent = option.value ? option.value.replace(/pt$/, "") : "Padrao";
      });
      select.setAttribute("aria-label", "Tamanho da fonte");
      select.addEventListener("change", function(event) {
        if (event.target.value) {
          applyFontSize(event.target.value);
        }
      });
    }

    group = document.createElement("span");
    group.className = "ql-formats ql-font-size-manual-group";

    input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = "200";
    input.step = "1";
    input.inputMode = "decimal";
    input.className = "ql-font-size-manual";
    input.setAttribute("aria-label", "Tamanho da fonte em pontos");
    input.addEventListener("change", function() {
      applyFontSize(input.value + "pt");
    });
    input.addEventListener("keydown", function(event) {
      if (event.key === "Enter") {
        event.preventDefault();
        applyFontSize(input.value + "pt");
      }
    });

    suffix = document.createElement("span");
    suffix.className = "ql-font-size-suffix";
    suffix.textContent = "pt";

    group.appendChild(input);
    group.appendChild(suffix);
    toolbar.appendChild(group);

    if (quill && typeof quill.on === "function") {
      quill.on("selection-change", updateFontSizeToolbar);
      quill.on("editor-change", updateFontSizeToolbar);
    }

    updateFontSizeToolbar();
  }

  function initEditor() {
    if (!els.quillEditor) return;
    registerFontSizeAttributor();
    quill = new Quill('#quill-editor', {
      theme: 'snow',
      modules: {
        toolbar: [
          [{ 'header': [1, 2, 3, false] }],
          [{ 'size': FONT_SIZE_VALUES }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          ['clean']
        ]
      }
    });
    setupFontSizeToolbar();
  }

  function handleNewTemplate() {
    currentTemplateId = null;
    if (els.editorForm) els.editorForm.reset();
    if (quill && quill.setContents) {
      quill.setContents([]);
      quill.blur();
    } else if (quill && quill.root) {
      quill.root.innerHTML = "";
    }
    if (els.tplFolder) els.tplFolder.value = activeFolderId || "";
    if (els.deleteTemplateBtn) els.deleteTemplateBtn.style.display = 'none';
    window.setTimeout(function() {
      if (els.tplName) {
        els.tplName.focus();
      }
    }, 100);
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

    if (!userId) {
      userId = await getStoredUserId();
    }

    if (!userId) {
      showToast("Usuário não carregado. Faça login novamente.");
      return;
    }

    var shortcut = els.tplShortcut.value.trim().replace(/^\//, '').toLowerCase();
    if (!shortcut) {
      showShortcutError("Informe um atalho.");
      return;
    }

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

    var tpl = {
      id: currentTemplateId || crypto.randomUUID(),
      name: els.tplName.value.trim(),
      shortcut: shortcut,
      folder_id: folderId,
      content: getTemplateStorageHtml(quill.root.innerHTML),
      plain_text: quill.getText(),
      user_id: userId,
      updated_at: nowIso
    };

    tpl.created_at = existing && existing.created_at ? existing.created_at : nowIso;

    try {
      if (window.MinutarioDB && window.MinutarioDB.saveTemplate) {
        await window.MinutarioDB.saveTemplate(tpl);
      } else if (window.MinutarioDB && window.MinutarioDB.putTemplate) {
        await window.MinutarioDB.putTemplate(tpl);
      } else {
        throw new Error("MinutarioDB save API not available");
      }
      currentTemplateId = tpl.id;

    } catch (err) {
      console.error(err);
      showToast("Erro ao salvar template: " + (err && err.message ? err.message : err));
      return;
    }

    showToast("Template salvo com sucesso!");

    try {
      await syncAfterMutation(existing ? "template:update" : "template:create");
    } catch (syncErr) {
      console.error("Post-save sync error:", syncErr);
      setImportStatus("Template salvo localmente. Sync falhou: " + (syncErr && syncErr.message ? syncErr.message : syncErr), true);
    }

    try {
      await notifyTemplatesUpdated();
      await loadTemplates();
    } catch (loadErr) {
      console.error("Post-save reload error:", loadErr);
      setImportStatus("Template salvo, mas houve erro ao recarregar a lista: " + (loadErr && loadErr.message ? loadErr.message : loadErr), true);
    }
  }

  async function handleDeleteTemplate() {
    if (!currentTemplateId) return;
    var confirmed = await showConfirmModal("Tem certeza que deseja excluir este template?");
    if (!confirmed) return;

    try {
      if (window.MinutarioDB && window.MinutarioDB.deleteTemplate) {
        if (userId && window.MinutarioSync && window.MinutarioSync.recordTemplateDelete) {
          await window.MinutarioSync.recordTemplateDelete(userId, currentTemplateId);
        }
        await window.MinutarioDB.deleteTemplate(currentTemplateId);
      } else {
        throw new Error("MinutarioDB delete API not available");
      }

      showToast("Template excluído!");
      handleNewTemplate();
      await syncAfterMutation("template:delete");
      await notifyTemplatesUpdated();
      await loadTemplates();
    } catch (err) {
      console.error(err);
      showToast("Erro ao excluir template");
    }
  }

  async function handleNewFolder() {
    var name = await showInputModal("Nome da pasta:");
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

      await loadFolders();
      setActiveFolder(folder.id);
      if (els.tplFolder) els.tplFolder.value = folder.id;
      await syncAfterMutation("folder:create");
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

    var folderConfirmed = await showConfirmModal("Tem certeza que deseja excluir esta pasta?");
    if (!folderConfirmed) return;

    try {
      if (window.MinutarioDB && window.MinutarioDB.deleteFolder) {
        if (userId && window.MinutarioSync && window.MinutarioSync.recordFolderDelete) {
          await window.MinutarioSync.recordFolderDelete(userId, activeFolderId);
        }
        await window.MinutarioDB.deleteFolder(activeFolderId);
      } else {
        throw new Error("MinutarioDB folder delete API not available");
      }

      activeFolderId = null;
      await loadFolders();
      filterAndRender();
      if (els.tplFolder) els.tplFolder.value = "";
      await syncAfterMutation("folder:delete");
      showToast("Pasta excluída!");
    } catch (err) {
      console.error(err);
      showToast("Erro ao excluir pasta");
    }
  }

  async function handleRenameFolder() {
    if (!activeFolderId) return;

    var folder = getFolderById(activeFolderId);
    if (!folder) return;

    var nextName = await showInputModal("Novo nome da pasta:", folder.name || "");
    if (!nextName) return;

    nextName = nextName.trim();
    if (!nextName || nextName === folder.name) return;

    try {
      var nowIso = new Date().toISOString();
      var updatedFolder = Object.assign({}, folder, {
        name: nextName,
        user_id: userId || folder.user_id || null,
        updated_at: nowIso,
      });

      if (window.MinutarioDB && window.MinutarioDB.saveFolder) {
        await window.MinutarioDB.saveFolder(updatedFolder);
      } else if (window.MinutarioDB && window.MinutarioDB.putFolder) {
        await window.MinutarioDB.putFolder(updatedFolder);
      } else {
        throw new Error("MinutarioDB folder save API not available");
      }

      await loadFolders();
      setActiveFolder(updatedFolder.id);
      await syncAfterMutation("folder:update");
      showToast("Pasta renomeada com sucesso!");
    } catch (err) {
      console.error(err);
      showToast("Erro ao renomear pasta");
    }
  }

  // Keyboard shortcuts
  function handleKeydown(event) {
    // Skip all keyboard shortcuts while a modal dialog is open
    if (_modalOpen) return;

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
    try {
      var client = window.MinutarioAPI.getClient();
      if (client && window.MinutarioAPI.restoreSessionFromStorage) {
        await window.MinutarioAPI.restoreSessionFromStorage(client);
        var userResult = await client.auth.getUser();
        if (userResult && !userResult.error && userResult.data && userResult.data.user) {
          await saveUserId(getUserIdFromUser(userResult.data.user));
          await initDashboard();
          return;
        }
      }
    } catch (err) {
      console.error("Auth restore failed:", err);
      await clearTokens();
    }

    if (els.loginScreen) {
      showLoginScreen();
      await consumeDeepLinkIfAny();
    } else {
      // dashboard.html não tem login screen - carrega diretamente
      await initDashboard();
    }
  }

  // Events
  function bindEvents() {
    if (els.loginForm) els.loginForm.addEventListener("submit", handleLogin);
    if (els.signupForm) els.signupForm.addEventListener("submit", handleSignup);
    if (els.forgotForm) els.forgotForm.addEventListener("submit", handleForgotPassword);
    if (els.resetForm) els.resetForm.addEventListener("submit", handleResetPassword);
    if (els.goSignup) els.goSignup.addEventListener("click", function () { showAuthView("signup"); });
    if (els.goForgot) els.goForgot.addEventListener("click", function () { showAuthView("forgot"); });
    if (els.backToLoginFromSignup) els.backToLoginFromSignup.addEventListener("click", function () { showAuthView("login"); });
    if (els.backToLoginFromForgot) els.backToLoginFromForgot.addEventListener("click", function () { showAuthView("login"); });
    if (els.backToLoginFromReset) els.backToLoginFromReset.addEventListener("click", function () { showAuthView("login"); });
    if (els.resendButton) els.resendButton.addEventListener("click", handleResendConfirmation);
    if (els.signupLgpdAccept) {
      els.signupLgpdAccept.addEventListener("change", function () {
        if (els.signupButton) {
          els.signupButton.disabled = !els.signupLgpdAccept.checked;
        }
      });
    }
    if (els.signupPassword) els.signupPassword.addEventListener("input", updateSignupPasswordFeedback);
    if (els.signupPasswordConfirm) els.signupPasswordConfirm.addEventListener("input", updateSignupConfirmFeedback);
    if (els.resetNewPassword) els.resetNewPassword.addEventListener("input", updateResetPasswordFeedback);
    if (els.resetConfirmPassword) els.resetConfirmPassword.addEventListener("input", updateResetConfirmFeedback);
    if (els.logoutBtn) els.logoutBtn.addEventListener("click", handleLogout);
    if (els.searchInput) els.searchInput.addEventListener("input", handleSearchInput);
    if (els.newTemplateBtn) els.newTemplateBtn.addEventListener("click", handleNewTemplate);
    if (els.importCsvInput) els.importCsvInput.addEventListener("change", handleCsvImport);
    if (els.exportCsvBtn) els.exportCsvBtn.addEventListener("click", handleCsvExport);
    if (els.supabaseSyncBtn) els.supabaseSyncBtn.addEventListener("click", handleForceSync);
    if (els.editorForm) els.editorForm.addEventListener("submit", handleSaveTemplate);
    if (els.deleteTemplateBtn) els.deleteTemplateBtn.addEventListener("click", handleDeleteTemplate);
    if (els.newFolderBtn) els.newFolderBtn.addEventListener("click", handleNewFolder);
    if (els.renameFolderBtn) els.renameFolderBtn.addEventListener("click", handleRenameFolder);
    if (els.deleteFolderBtn) els.deleteFolderBtn.addEventListener("click", handleDeleteFolder);
    document.addEventListener("keydown", handleKeydown);

    if (authUi.setupPasswordToggle) {
      authUi.setupPasswordToggle(els.loginPassword, document.getElementById("toggle-login-password"));
      authUi.setupPasswordToggle(els.signupPassword, document.getElementById("toggle-signup-password"));
      authUi.setupPasswordToggle(els.signupPasswordConfirm, document.getElementById("toggle-signup-password-confirm"));
      authUi.setupPasswordToggle(els.resetNewPassword, document.getElementById("toggle-reset-new-password"));
      authUi.setupPasswordToggle(els.resetConfirmPassword, document.getElementById("toggle-reset-confirm-password"));
    }

    if (
      window.__TAURI__ &&
      window.__TAURI__.event &&
      typeof window.__TAURI__.event.listen === "function"
    ) {
      window.__TAURI__.event.listen("minutario://deep-link", function () {
        consumeDeepLinkIfAny();
      });
    }
  }

  cacheElements();
  bindEvents();
  init();
})();
