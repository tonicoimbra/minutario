mod clipboard;
mod db;
mod hooks;

use db::sqlite::*;
use hooks::keyboard;
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::TrayIconBuilder,
    Manager, State, WindowEvent,
};

pub struct AppDb {
    conn: Arc<Mutex<rusqlite::Connection>>,
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

#[tauri::command]
fn toggle_hook(enabled: bool, db_state: State<AppDb>) -> Result<bool, String> {
    if enabled {
        if keyboard::is_hook_active() {
            return Ok(true);
        }
        let trigger_char = {
            let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
            let tc = db::sqlite::get_setting(&conn, "triggerChar")
                .ok()
                .flatten()
                .unwrap_or_else(|| "/".to_string());
            tc.chars().next().unwrap_or('/')
        };
        let trigger_key_vks = vec![0x20]; // VK_SPACE
        keyboard::start_hook(db_state.conn.clone(), trigger_char, trigger_key_vks);
        Ok(true)
    } else {
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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let conn = db::sqlite::init_db(app.handle()).expect("failed to init database");
            let conn = Arc::new(Mutex::new(conn));
            app.manage(AppDb { conn: conn.clone() });

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
                            let active = keyboard::is_hook_active();
                            if active {
                                keyboard::stop_hook();
                            } else {
                                let db_state = app.state::<AppDb>();
                                let trigger_char = {
                                    let conn = db_state.conn.lock().unwrap();
                                    db::sqlite::get_setting(&conn, "triggerChar")
                                        .ok()
                                        .flatten()
                                        .unwrap_or_else(|| "/".to_string())
                                        .chars()
                                        .next()
                                        .unwrap_or('/')
                                };
                                keyboard::start_hook(
                                    db_state.conn.clone(),
                                    trigger_char,
                                    vec![0x20],
                                );
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

            keyboard::start_hook(conn, '/', vec![0x20]);

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
        ])
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let _ = window.hide();
                api.prevent_close();
            }
        })
        .run(tauri::generate_context!())
        .expect("erro ao iniciar Minutário Desktop");
}
