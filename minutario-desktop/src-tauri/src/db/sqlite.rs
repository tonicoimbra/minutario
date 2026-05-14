use rusqlite::{params, Connection, Result as SqlResult};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use std::path::PathBuf;
use tauri::AppHandle;
use tauri::Manager;

fn string_or_default<'de, D>(deserializer: D) -> Result<String, D::Error>
where
    D: Deserializer<'de>,
{
    let value = Option::<Value>::deserialize(deserializer)?;
    Ok(match value {
        Some(Value::String(text)) => text,
        Some(Value::Number(number)) => number.to_string(),
        Some(Value::Bool(value)) => value.to_string(),
        Some(Value::Null) | None => String::new(),
        Some(other) => other.to_string(),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Template {
    pub id: String,
    #[serde(default, alias = "userId", deserialize_with = "string_or_default")]
    pub user_id: String,
    pub name: String,
    pub shortcut: String,
    pub content: String,
    #[serde(default, alias = "plainText", deserialize_with = "string_or_default")]
    pub plain_text: String,
    #[serde(default, alias = "folderId")]
    pub folder_id: Option<String>,
    #[serde(default, alias = "createdAt", deserialize_with = "string_or_default")]
    pub created_at: String,
    #[serde(default, alias = "updatedAt", deserialize_with = "string_or_default")]
    pub updated_at: String,
    #[serde(default, alias = "deletedAt")]
    pub deleted_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Folder {
    pub id: String,
    #[serde(default, alias = "userId", deserialize_with = "string_or_default")]
    pub user_id: String,
    pub name: String,
    #[serde(default, alias = "order")]
    pub order_idx: i32,
    #[serde(alias = "createdAt")]
    pub created_at: String,
    #[serde(alias = "updatedAt")]
    pub updated_at: String,
    #[serde(default, alias = "deletedAt")]
    pub deleted_at: Option<String>,
}

fn db_path(app: &AppHandle) -> PathBuf {
    let app_dir = app.path().app_data_dir().expect("app data dir");
    std::fs::create_dir_all(&app_dir).ok();
    app_dir.join("minutario.db")
}

pub fn init_db(app: &AppHandle) -> SqlResult<Connection> {
    let path = db_path(app);
    let conn = Connection::open(&path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS templates (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL,
            name        TEXT NOT NULL,
            shortcut    TEXT NOT NULL,
            content     TEXT NOT NULL DEFAULT '',
            plain_text  TEXT NOT NULL DEFAULT '',
            folder_id   TEXT,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            deleted_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_templates_user ON templates(user_id);
        CREATE INDEX IF NOT EXISTS idx_templates_user_shortcut ON templates(user_id, shortcut);

        CREATE TABLE IF NOT EXISTS folders (
            id          TEXT PRIMARY KEY,
            user_id     TEXT NOT NULL,
            name        TEXT NOT NULL,
            order_idx   INTEGER NOT NULL DEFAULT 0,
            created_at  TEXT NOT NULL DEFAULT (datetime('now')),
            updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
            deleted_at  TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_folders_user ON folders(user_id);

        CREATE TABLE IF NOT EXISTS settings (
            key   TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );",
    )?;
    Ok(conn)
}

pub fn get_all_templates(conn: &Connection, user_id: &str) -> SqlResult<Vec<Template>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, name, shortcut, content, plain_text, folder_id, created_at, updated_at, deleted_at
         FROM templates WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY name"
    )?;
    let rows = stmt.query_map(params![user_id], |row| {
        Ok(Template {
            id: row.get(0)?,
            user_id: row.get(1)?,
            name: row.get(2)?,
            shortcut: row.get(3)?,
            content: row.get(4)?,
            plain_text: row.get(5)?,
            folder_id: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            deleted_at: row.get(9)?,
        })
    })?;
    rows.collect()
}

pub fn save_template(conn: &Connection, tpl: &Template) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO templates (id, user_id, name, shortcut, content, plain_text, folder_id, created_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            shortcut = excluded.shortcut,
            content = excluded.content,
            plain_text = excluded.plain_text,
            folder_id = excluded.folder_id,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at",
        params![tpl.id, tpl.user_id, tpl.name, tpl.shortcut, tpl.content, tpl.plain_text, tpl.folder_id, tpl.created_at, tpl.updated_at, tpl.deleted_at],
    )?;
    Ok(())
}

pub fn delete_template(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM templates WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn delete_all_templates(conn: &Connection, user_id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM templates WHERE user_id = ?1", params![user_id])?;
    Ok(())
}

pub fn get_template_by_shortcut(conn: &Connection, user_id: &str, shortcut: &str) -> SqlResult<Option<Template>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, name, shortcut, content, plain_text, folder_id, created_at, updated_at, deleted_at
         FROM templates WHERE user_id = ?1 AND shortcut = ?2 AND deleted_at IS NULL LIMIT 1"
    )?;
    let mut rows = stmt.query(params![user_id, shortcut])?;
    match rows.next()? {
        Some(row) => Ok(Some(Template {
            id: row.get(0)?,
            user_id: row.get(1)?,
            name: row.get(2)?,
            shortcut: row.get(3)?,
            content: row.get(4)?,
            plain_text: row.get(5)?,
            folder_id: row.get(6)?,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
            deleted_at: row.get(9)?,
        })),
        None => Ok(None),
    }
}

pub fn get_all_folders(conn: &Connection, user_id: &str) -> SqlResult<Vec<Folder>> {
    let mut stmt = conn.prepare(
        "SELECT id, user_id, name, order_idx, created_at, updated_at, deleted_at
         FROM folders WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY order_idx, name"
    )?;
    let rows = stmt.query_map(params![user_id], |row| {
        Ok(Folder {
            id: row.get(0)?,
            user_id: row.get(1)?,
            name: row.get(2)?,
            order_idx: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            deleted_at: row.get(6)?,
        })
    })?;
    rows.collect()
}

pub fn save_folder(conn: &Connection, folder: &Folder) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO folders (id, user_id, name, order_idx, created_at, updated_at, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
            name = excluded.name,
            order_idx = excluded.order_idx,
            updated_at = excluded.updated_at,
            deleted_at = excluded.deleted_at",
        params![folder.id, folder.user_id, folder.name, folder.order_idx, folder.created_at, folder.updated_at, folder.deleted_at],
    )?;
    Ok(())
}

pub fn delete_folder(conn: &Connection, id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM folders WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn delete_all_folders(conn: &Connection, user_id: &str) -> SqlResult<()> {
    conn.execute("DELETE FROM folders WHERE user_id = ?1", params![user_id])?;
    Ok(())
}

pub fn set_setting(conn: &Connection, key: &str, value: &str) -> SqlResult<()> {
    conn.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )?;
    Ok(())
}

pub fn get_setting(conn: &Connection, key: &str) -> SqlResult<Option<String>> {
    let mut stmt = conn.prepare("SELECT value FROM settings WHERE key = ?1")?;
    let mut rows = stmt.query(params![key])?;
    match rows.next()? {
        Some(row) => Ok(Some(row.get(0)?)),
        None => Ok(None),
    }
}
