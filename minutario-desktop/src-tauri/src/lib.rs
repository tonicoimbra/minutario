mod clipboard;
mod db;
mod hooks;

use db::sqlite::*;
use hooks::keyboard;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::{
    Emitter,
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, State, WindowEvent,
};

pub struct AppDb {
    conn: Arc<Mutex<rusqlite::Connection>>,
}

pub struct DeepLinkState {
    pending_url: Arc<Mutex<Option<String>>>,
}

pub struct HookControlState {
    enabled_by_user: Arc<Mutex<bool>>,
    paused_for_focus: Arc<Mutex<bool>>,
}

#[derive(serde::Serialize, serde::Deserialize)]
struct AuthSessionPayload {
    access_token: String,
    refresh_token: String,
}

fn extract_deep_link_from_args(args: &[String]) -> Option<String> {
    args.iter()
        .find(|arg| arg.starts_with("tauri://localhost/"))
        .cloned()
}

fn configure_portable_webview2_runtime() {
    let exe_path = match std::env::current_exe() {
        Ok(path) => path,
        Err(_) => return,
    };

    let exe_dir = match exe_path.parent() {
        Some(path) => path,
        None => return,
    };

    let fixed_runtime_dir = exe_dir.join("webview2-fixed");
    let runtime_exe = fixed_runtime_dir.join("msedgewebview2.exe");

    if runtime_exe.exists() {
        std::env::set_var(
            "WEBVIEW2_BROWSER_EXECUTABLE_FOLDER",
            fixed_runtime_dir.as_os_str(),
        );
    }
}

#[tauri::command]
fn get_templates(user_id: String, db_state: State<AppDb>) -> Result<Vec<Template>, String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    get_all_templates(&conn, &user_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_template(mut tpl: Template, db_state: State<AppDb>) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    if tpl.user_id.trim().is_empty() {
        tpl.user_id = db::sqlite::get_setting(&conn, "minutario_user_id")
            .ok()
            .flatten()
            .and_then(|value| {
                serde_json::from_str::<String>(&value)
                    .ok()
                    .or_else(|| if value.trim().is_empty() { None } else { Some(value) })
            })
            .ok_or_else(|| "Usuário não carregado. Faça login novamente antes de salvar.".to_string())?;
    }
    db::sqlite::save_template(&conn, &tpl).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_template(id: String, db_state: State<AppDb>) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    db::sqlite::delete_template(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_all_templates(user_id: String, db_state: State<AppDb>) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    db::sqlite::delete_all_templates(&conn, &user_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_template_by_shortcut(user_id: String, shortcut: String, db_state: State<AppDb>) -> Result<Option<Template>, String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    db::sqlite::get_template_by_shortcut(&conn, &user_id, &shortcut).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_folders(user_id: String, db_state: State<AppDb>) -> Result<Vec<Folder>, String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    get_all_folders(&conn, &user_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn save_folder(mut folder: Folder, db_state: State<AppDb>) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    if folder.user_id.trim().is_empty() {
        folder.user_id = db::sqlite::get_setting(&conn, "minutario_user_id")
            .ok()
            .flatten()
            .and_then(|value| {
                serde_json::from_str::<String>(&value)
                    .ok()
                    .or_else(|| if value.trim().is_empty() { None } else { Some(value) })
            })
            .ok_or_else(|| "Usuário não carregado. Faça login novamente antes de salvar.".to_string())?;
    }
    db::sqlite::save_folder(&conn, &folder).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_folder(id: String, db_state: State<AppDb>) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    db::sqlite::delete_folder(&conn, &id).map_err(|e| e.to_string())
}

#[tauri::command]
fn delete_all_folders(user_id: String, db_state: State<AppDb>) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    db::sqlite::delete_all_folders(&conn, &user_id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_setting(key: String, db_state: State<AppDb>) -> Result<Option<String>, String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    db::sqlite::get_setting(&conn, &key).map_err(|e| e.to_string())
}

#[tauri::command]
fn set_setting(key: String, value: String, db_state: State<AppDb>) -> Result<(), String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    db::sqlite::set_setting(&conn, &key, &value).map_err(|e| e.to_string())
}

#[tauri::command]
fn generate_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

#[tauri::command]
fn now_iso() -> String {
    chrono::Utc::now().to_rfc3339()
}

fn resolve_trigger_char(db_conn: &Arc<Mutex<rusqlite::Connection>>) -> char {
    let conn = match db_conn.lock() {
        Ok(conn) => conn,
        Err(_) => return '/',
    };

    let tc = db::sqlite::get_setting(&conn, "triggerChar")
        .ok()
        .flatten()
        .unwrap_or_else(|| "/".to_string());
    tc.chars().next().unwrap_or('/')
}

fn start_keyboard_hook(db_conn: Arc<Mutex<rusqlite::Connection>>) {
    let trigger_char = resolve_trigger_char(&db_conn);
    keyboard::start_hook(db_conn, trigger_char, vec![0x20]); // VK_SPACE
}

#[tauri::command]
fn toggle_hook(
    enabled: bool,
    db_state: State<AppDb>,
    hook_control: State<HookControlState>,
) -> Result<bool, String> {
    if enabled {
        if let Ok(mut desired) = hook_control.enabled_by_user.lock() {
            *desired = true;
        }
        if let Ok(mut paused) = hook_control.paused_for_focus.lock() {
            *paused = false;
        }
        if keyboard::is_hook_active() {
            return Ok(true);
        }
        start_keyboard_hook(db_state.conn.clone());
        Ok(true)
    } else {
        if let Ok(mut desired) = hook_control.enabled_by_user.lock() {
            *desired = false;
        }
        if let Ok(mut paused) = hook_control.paused_for_focus.lock() {
            *paused = false;
        }
        keyboard::stop_hook();
        Ok(false)
    }
}

#[tauri::command]
fn get_hook_status() -> bool {
    keyboard::is_hook_active()
}

#[tauri::command]
async fn supabase_password_login(
    supabase_url: String,
    anon_key: String,
    email: String,
    password: String,
) -> Result<Value, String> {
    let base_url = supabase_url.trim().trim_end_matches('/');
    if base_url.is_empty() || anon_key.trim().is_empty() {
        return Err("Configuração do Supabase ausente.".to_string());
    }

    let url = format!("{base_url}/auth/v1/token?grant_type=password");
    let client = reqwest::Client::new();
    let response = client
        .post(url)
        .header("apikey", anon_key.trim())
        .header("Authorization", format!("Bearer {}", anon_key.trim()))
        .json(&json!({
            "email": email.trim(),
            "password": password,
        }))
        .send()
        .await
        .map_err(|e| format!("Falha de rede no login Supabase: {e}"))?;

    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| format!("Falha ao ler resposta do Supabase: {e}"))?;

    let parsed: Value = serde_json::from_str(&body).unwrap_or_else(|_| json!({ "message": body }));

    if !status.is_success() {
        let message = parsed
            .get("error_description")
            .or_else(|| parsed.get("msg"))
            .or_else(|| parsed.get("message"))
            .and_then(|v| v.as_str())
            .filter(|v| !v.trim().is_empty())
            .unwrap_or("Login recusado pelo Supabase.");

        return Err(message.to_string());
    }

    Ok(parsed)
}

#[tauri::command]
fn store_auth_session(service: String, access_token: String, refresh_token: String) -> Result<(), String> {
    let entry = keyring::Entry::new(
        if service.trim().is_empty() {
            "com.minutario.desktop.auth"
        } else {
            service.trim()
        },
        "supabase_session",
    )
    .map_err(|e| format!("Falha ao acessar keyring: {e}"))?;

    let payload = AuthSessionPayload {
        access_token,
        refresh_token,
    };
    let serialized =
        serde_json::to_string(&payload).map_err(|e| format!("Falha ao serializar sessão: {e}"))?;

    entry
        .set_password(&serialized)
        .map_err(|e| format!("Falha ao gravar sessão segura: {e}"))
}

#[tauri::command]
fn read_auth_session(service: String) -> Result<Option<AuthSessionPayload>, String> {
    let entry = keyring::Entry::new(
        if service.trim().is_empty() {
            "com.minutario.desktop.auth"
        } else {
            service.trim()
        },
        "supabase_session",
    )
    .map_err(|e| format!("Falha ao acessar keyring: {e}"))?;

    match entry.get_password() {
        Ok(raw) => {
            let parsed: AuthSessionPayload = serde_json::from_str(&raw)
                .map_err(|e| format!("Sessão inválida no keyring: {e}"))?;
            Ok(Some(parsed))
        }
        Err(err) => {
            let msg = err.to_string().to_lowercase();
            if msg.contains("no entry") || msg.contains("not found") {
                Ok(None)
            } else {
                Err(format!("Falha ao ler sessão segura: {err}"))
            }
        }
    }
}

#[tauri::command]
fn clear_auth_session(service: String) -> Result<(), String> {
    let entry = keyring::Entry::new(
        if service.trim().is_empty() {
            "com.minutario.desktop.auth"
        } else {
            service.trim()
        },
        "supabase_session",
    )
    .map_err(|e| format!("Falha ao acessar keyring: {e}"))?;

    match entry.delete_credential() {
        Ok(_) => Ok(()),
        Err(err) => {
            let msg = err.to_string().to_lowercase();
            if msg.contains("no entry") || msg.contains("not found") {
                Ok(())
            } else {
                Err(format!("Falha ao limpar sessão segura: {err}"))
            }
        }
    }
}

#[tauri::command]
fn consume_pending_deep_link(state: State<DeepLinkState>) -> Option<String> {
    state.pending_url.lock().ok().and_then(|mut guard| guard.take())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    configure_portable_webview2_runtime();

    let initial_args: Vec<String> = std::env::args().collect();
    let initial_deep_link = extract_deep_link_from_args(&initial_args);

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(url) = extract_deep_link_from_args(&argv) {
                if let Some(state) = app.try_state::<DeepLinkState>() {
                    if let Ok(mut pending) = state.pending_url.lock() {
                        *pending = Some(url.clone());
                    }
                }
                let _ = app.emit("minutario://deep-link", url);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let conn = db::sqlite::init_db(app.handle()).expect("failed to init database");
            let conn = Arc::new(Mutex::new(conn));
            app.manage(AppDb { conn: conn.clone() });
            app.manage(DeepLinkState {
                pending_url: Arc::new(Mutex::new(initial_deep_link.clone())),
            });
            app.manage(HookControlState {
                enabled_by_user: Arc::new(Mutex::new(true)),
                paused_for_focus: Arc::new(Mutex::new(false)),
            });

            let open_item = MenuItem::with_id(app, "open", "Abrir Minutário", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let toggle_item = MenuItem::with_id(app, "toggle", "Desativar expansão", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Sair", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &sep, &toggle_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().unwrap())
                .tooltip("Minutário")
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id().as_ref() {
                        "open" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "toggle" => {
                            let hook_control = app.state::<HookControlState>();
                            let active = keyboard::is_hook_active();
                            if active {
                                if let Ok(mut desired) = hook_control.enabled_by_user.lock() {
                                    *desired = false;
                                }
                                if let Ok(mut paused) = hook_control.paused_for_focus.lock() {
                                    *paused = false;
                                }
                                keyboard::stop_hook();
                            } else {
                                if let Ok(mut desired) = hook_control.enabled_by_user.lock() {
                                    *desired = true;
                                }
                                if let Ok(mut paused) = hook_control.paused_for_focus.lock() {
                                    *paused = false;
                                }
                                let db_state = app.state::<AppDb>();
                                start_keyboard_hook(db_state.conn.clone());
                            }
                            if let Some(_tray) = app.tray_by_id("main") {
                                let _tooltip = if !active { "Minutário — Expansão ativa" } else { "Minutário — Expansão desativada" };
                            }
                        }
                        "quit" => {
                            keyboard::stop_hook();
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            start_keyboard_hook(conn);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_templates,
            save_template,
            delete_template,
            delete_all_templates,
            get_template_by_shortcut,
            get_folders,
            save_folder,
            delete_folder,
            delete_all_folders,
            get_setting,
            set_setting,
            generate_id,
            now_iso,
            toggle_hook,
            get_hook_status,
            supabase_password_login,
            store_auth_session,
            read_auth_session,
            clear_auth_session,
            consume_pending_deep_link,
        ])
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::Focused(focused) = event {
                    let app = window.app_handle();
                    let hook_control = app.state::<HookControlState>();
                    let desired_enabled = hook_control
                        .enabled_by_user
                        .lock()
                        .map(|v| *v)
                        .unwrap_or(true);

                    if *focused {
                        if desired_enabled && keyboard::is_hook_active() {
                            if let Ok(mut paused) = hook_control.paused_for_focus.lock() {
                                *paused = true;
                            }
                            keyboard::stop_hook();
                        }
                    } else if desired_enabled {
                        let paused_for_focus = hook_control
                            .paused_for_focus
                            .lock()
                            .map(|v| *v)
                            .unwrap_or(false);
                        if paused_for_focus && !keyboard::is_hook_active() {
                            if let Ok(mut paused) = hook_control.paused_for_focus.lock() {
                                *paused = false;
                            }
                            let db_state = app.state::<AppDb>();
                            start_keyboard_hook(db_state.conn.clone());
                        }
                    }
                }
            }

            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar Minutário Desktop");
}
