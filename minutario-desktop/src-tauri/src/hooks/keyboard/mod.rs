mod input;

use crate::clipboard::manager as clip;
use crate::db::sqlite;
use input::{simulate_backspace, simulate_paste};

use rusqlite::Connection;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use windows::Win32::Foundation::*;
use windows::Win32::System::Threading::{GetCurrentProcessId, GetCurrentThreadId};
use windows::Win32::UI::Input::KeyboardAndMouse::*;
use windows::Win32::UI::WindowsAndMessaging::*;

static HOOK_ACTIVE: AtomicBool = AtomicBool::new(false);

struct HookState {
    buffer: String,
    trigger_char: char,
    trigger_key_vks: Vec<u8>,
    db_conn: Arc<Mutex<Connection>>,
    own_pid: u32,
}

#[derive(Default)]
struct HookRuntime {
    state: Option<HookState>,
    thread_id: Option<u32>,
}

static HOOK_RUNTIME: OnceLock<Mutex<HookRuntime>> = OnceLock::new();

fn runtime() -> &'static Mutex<HookRuntime> {
    HOOK_RUNTIME.get_or_init(|| Mutex::new(HookRuntime::default()))
}

/// Check if the foreground window belongs to our own process.
/// When true, we skip hook processing so typing inside the
/// Minutário dashboard works normally.
fn is_own_window_focused(own_pid: u32) -> bool {
    unsafe {
        let fg = GetForegroundWindow();
        if fg.is_invalid() || fg.0.is_null() {
            return false;
        }
        let mut fg_pid: u32 = 0;
        GetWindowThreadProcessId(fg, Some(&mut fg_pid));
        fg_pid == own_pid
    }
}

unsafe extern "system" fn low_level_keyboard_proc(
    n_code: i32,
    w_param: WPARAM,
    l_param: LPARAM,
) -> LRESULT {
    if n_code >= 0
        && w_param.0 == WM_KEYDOWN as usize
        && HOOK_ACTIVE.load(Ordering::Relaxed)
    {
        let kb_struct = &*(l_param.0 as *const KBDLLHOOKSTRUCT);
        if (kb_struct.flags.0 & LLKHF_INJECTED.0) != 0 {
            return CallNextHookEx(None, n_code, w_param, l_param);
        }

        let vk = kb_struct.vkCode;
        let scan_code = kb_struct.scanCode;

        let runtime_lock = runtime();
        let mut runtime = runtime_lock.lock().unwrap();

        if let Some(state) = runtime.state.as_mut() {
            // Skip hook processing when typing inside our own window
            if is_own_window_focused(state.own_pid) {
                return CallNextHookEx(None, n_code, w_param, l_param);
            }

            if vk == VK_BACK.0 as u32 {
                if !state.buffer.is_empty() {
                    state.buffer.pop();
                }
                return CallNextHookEx(None, n_code, w_param, l_param);
            }

            if vk == VK_ESCAPE.0 as u32 {
                state.buffer.clear();
                return CallNextHookEx(None, n_code, w_param, l_param);
            }

            let is_trigger_key = state.trigger_key_vks.contains(&(vk as u8));
            let ch = vk_to_char(vk, scan_code);

            if let Some(c) = ch {
                state.buffer.push(c);
                if state.buffer.len() > 80 {
                    let excess = state.buffer.len() - 80;
                    state.buffer.drain(..excess);
                }
            }

            if is_trigger_key && !state.buffer.is_empty() {
                let trigger = state.trigger_char;
                let buf = &state.buffer;

                if let Some(pos) = buf.rfind(trigger) {
                    let shortcut = &buf[pos + trigger.len_utf8()..];
                    let shortcut = shortcut.trim();

                    if !shortcut.is_empty()
                        && shortcut
                            .chars()
                            .all(|c| c.is_alphanumeric() || c == '-')
                    {
                        let shortcut_str = shortcut.to_string();
                        let chars_to_delete = shortcut_str.len() + 1;
                        let conn = state.db_conn.clone();
                        state.buffer.clear();
                        drop(runtime);

                        let template = {
                            let c = conn.lock().unwrap();
                            sqlite::get_setting(&c, "minutario_user_id")
                                .ok()
                                .flatten()
                                .and_then(|user_id| decode_setting_string(&user_id))
                                .and_then(|user_id| {
                                    sqlite::get_template_by_shortcut(&c, &user_id, &shortcut_str)
                                        .ok()
                                        .flatten()
                                })
                        };

                        if let Some(tpl) = template {
                            let content = tpl.content.clone();
                            let plain = tpl.plain_text.clone();

                            thread::spawn(move || {
                                thread::sleep(Duration::from_millis(30));
                                simulate_backspace(chars_to_delete);
                                thread::sleep(Duration::from_millis(30));
                                let _ = clip::set_clipboard_html(&content, &plain);
                                thread::sleep(Duration::from_millis(20));
                                simulate_paste();
                            });

                            return LRESULT(1);
                        }

                        return CallNextHookEx(None, n_code, w_param, l_param);
                    }
                }

                state.buffer.clear();
            }
        }
    }

    CallNextHookEx(None, n_code, w_param, l_param)
}

fn decode_setting_string(value: &str) -> Option<String> {
    if value.trim().is_empty() {
        return None;
    }

    if let Ok(parsed) = serde_json::from_str::<String>(value) {
        if !parsed.trim().is_empty() {
            return Some(parsed);
        }
    }

    Some(value.to_string())
}

fn vk_to_char(vk: u32, scan_code: u32) -> Option<char> {
    unsafe {
        let mut keyboard_state = [0u8; 256];
        if GetKeyboardState(&mut keyboard_state).is_err() {
            return fallback_vk_to_char(vk);
        }

        let mut buffer = [0u16; 8];
        // Use flag 0x4 (do not change keyboard state) to avoid
        // consuming dead keys and corrupting the translation state
        let result = ToUnicode(vk, scan_code, Some(&keyboard_state), &mut buffer, 0x4);

        if result > 0 {
            return char::from_u32(buffer[0] as u32).map(|c| c.to_ascii_lowercase());
        }
    }

    fallback_vk_to_char(vk)
}

fn fallback_vk_to_char(vk: u32) -> Option<char> {
    match vk {
        0x30..=0x39 => char::from_u32(vk - 0x30 + b'0' as u32),
        0x41..=0x5A => char::from_u32(vk - 0x41 + b'a' as u32),
        0x6D | 0xBD => Some('-'),
        0x6F | 0xBF => Some('/'),
        _ => None,
    }
}

pub fn start_hook(db_conn: Arc<Mutex<Connection>>, trigger_char: char, trigger_key_vks: Vec<u8>) {
    if HOOK_ACTIVE.swap(true, Ordering::Relaxed) {
        return;
    }

    let own_pid = unsafe { GetCurrentProcessId() };

    {
        let mut runtime = runtime().lock().unwrap();
        runtime.state = Some(HookState {
            buffer: String::new(),
            trigger_char,
            trigger_key_vks,
            db_conn: db_conn.clone(),
            own_pid,
        });
        runtime.thread_id = None;
    }

    thread::spawn(move || unsafe {
        let thread_id = GetCurrentThreadId();
        {
            let mut runtime = runtime().lock().unwrap();
            runtime.thread_id = Some(thread_id);
        }

        let hook = SetWindowsHookExW(
            WH_KEYBOARD_LL,
            Some(low_level_keyboard_proc),
            None,
            0,
        );

        match hook {
            Ok(h) => {
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).into() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }

                let _ = UnhookWindowsHookEx(h);
                HOOK_ACTIVE.store(false, Ordering::Relaxed);
            }
            Err(e) => {
                eprintln!("Failed to install keyboard hook: {e}");
                HOOK_ACTIVE.store(false, Ordering::Relaxed);
            }
        }

        let mut runtime = runtime().lock().unwrap();
        runtime.state = None;
        runtime.thread_id = None;
    });
}

pub fn stop_hook() {
    HOOK_ACTIVE.store(false, Ordering::Relaxed);
    let thread_id = runtime().lock().unwrap().thread_id;
    if let Some(thread_id) = thread_id {
        unsafe {
            let _ = PostThreadMessageW(thread_id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}

pub fn is_hook_active() -> bool {
    HOOK_ACTIVE.load(Ordering::Relaxed)
}

