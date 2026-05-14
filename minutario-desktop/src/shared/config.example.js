(function (global) {
  var CONFIG = {
    SUPABASE_URL: "https://your-project.supabase.co",
    SUPABASE_ANON_KEY: "your-anon-key",
    DB_NAME: "MinutarioDB",
    DB_VERSION: 1,
    SYNC_INTERVAL_MINUTES: 5,
    TEMPLATES_TABLE: "templates",
    FOLDERS_TABLE: "folders",
    LAST_SYNC_KEY: "minutario_last_sync",
    AUTH_TOKEN_KEY: "minutario_auth_token",
    EMAIL_CONFIRMATION_REDIRECT_URL: "",
    PASSWORD_RESET_REDIRECT_URL: "",
    PASSWORD_RESET_DESKTOP_REDIRECT_URL: "tauri://localhost/password-reset",
    DEBUG_LOGS: false,
  };
  global.MinutarioConfig = CONFIG;
})(typeof globalThis !== "undefined" ? globalThis : typeof window !== "undefined" ? window : this);
