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
  };
  global.MinutarioConfig = CONFIG;
})(typeof globalThis !== "undefined" ? globalThis : this);
