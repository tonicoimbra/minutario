use std::ffi::OsStr;
use std::os::windows::ffi::OsStrExt;
use windows::core::PCWSTR;
use windows::Win32::Foundation::*;
use windows::Win32::System::DataExchange::*;
use windows::Win32::System::Memory::*;
use windows::Win32::System::Ole::CF_UNICODETEXT;

fn wide(s: &str) -> Vec<u16> {
    OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
}

pub fn set_clipboard_html(html: &str, plain_text: &str) -> Result<(), String> {
    unsafe {
        OpenClipboard(None).map_err(|e| format!("OpenClipboard: {e}"))?;
        let _guard = scopeguard::guard((), |_| {
            let _ = CloseClipboard();
        });

        let _ = EmptyClipboard();
        set_unicode_text(plain_text)?;
        set_html_format(html)?;
        Ok(())
    }
}

unsafe fn set_unicode_text(text: &str) -> Result<(), String> {
    let wide = wide(text);
    let buf_len = wide.len() * 2;

    let h = GlobalAlloc(GMEM_MOVEABLE, buf_len).map_err(|e| format!("GlobalAlloc text: {e}"))?;

    let ptr = GlobalLock(h);
    if ptr.is_null() {
        let _ = GlobalFree(Some(h));
        return Err("GlobalLock text failed".into());
    }

    std::ptr::copy_nonoverlapping(wide.as_ptr() as *const u8, ptr as *mut u8, buf_len);
    let _ = GlobalUnlock(h);

    let handle = HANDLE(h.0);
    SetClipboardData(CF_UNICODETEXT.0 as u32, Some(handle))
        .map_err(|e| {
            let _ = GlobalFree(Some(h));
            format!("SetClipboardData text: {e}")
        })?;

    Ok(())
}

unsafe fn set_html_format(html: &str) -> Result<(), String> {
    let full = build_cf_html(html);
    let full_bytes = full.as_bytes();
    let buf_len = full_bytes.len() + 1;

    let h = GlobalAlloc(GMEM_MOVEABLE, buf_len).map_err(|e| format!("GlobalAlloc html: {e}"))?;

    let ptr = GlobalLock(h);
    if ptr.is_null() {
        let _ = GlobalFree(Some(h));
        return Err("GlobalLock html failed".into());
    }

    std::ptr::copy_nonoverlapping(full_bytes.as_ptr(), ptr as *mut u8, buf_len);
    *(ptr as *mut u8).add(buf_len - 1) = 0u8;
    let _ = GlobalUnlock(h);

    let format_name = wide("HTML Format");
    let cf_html = RegisterClipboardFormatW(PCWSTR(format_name.as_ptr()));

    let handle = HANDLE(h.0);
    SetClipboardData(cf_html, Some(handle))
        .map_err(|e| {
            let _ = GlobalFree(Some(h));
            format!("SetClipboardData html: {e}")
        })?;

    Ok(())
}

fn build_cf_html(fragment: &str) -> String {
    let header_template = [
        "Version:0.9\r\n",
        "StartHTML:0000000000\r\n",
        "EndHTML:0000000000\r\n",
        "StartFragment:0000000000\r\n",
        "EndFragment:0000000000\r\n",
    ]
    .concat();
    let html_prefix = concat!(
        r#"<html xmlns:o="urn:schemas-microsoft-com:office:office" "#,
        r#"xmlns:w="urn:schemas-microsoft-com:office:word" "#,
        r#"xmlns="http://www.w3.org/TR/REC-html40">"#,
        r#"<head><meta charset="utf-8"></head><body><!--StartFragment-->"#
    );
    let html_suffix = "<!--EndFragment--></body></html>";

    let start_html = header_template.as_bytes().len();
    let start_fragment = start_html + html_prefix.as_bytes().len();
    let end_fragment = start_fragment + fragment.as_bytes().len();
    let end_html = end_fragment + html_suffix.as_bytes().len();

    let header = format!(
        "Version:0.9\r\nStartHTML:{start_html:010}\r\nEndHTML:{end_html:010}\r\nStartFragment:{start_fragment:010}\r\nEndFragment:{end_fragment:010}\r\n"
    );

    format!("{header}{html_prefix}{fragment}{html_suffix}")
}

pub fn get_clipboard_text() -> Result<String, String> {
    unsafe {
        OpenClipboard(None).map_err(|e| format!("OpenClipboard: {e}"))?;
        let _guard = scopeguard::guard((), |_| {
            let _ = CloseClipboard();
        });

        let handle = match GetClipboardData(CF_UNICODETEXT.0 as u32) {
            Ok(h) => HGLOBAL(h.0),
            Err(_) => return Ok(String::new()),
        };

        let ptr = GlobalLock(handle);
        if ptr.is_null() {
            return Ok(String::new());
        }

        let wide_ptr = ptr as *const u16;
        let mut len = 0usize;
        while *wide_ptr.add(len) != 0 {
            len += 1;
        }

        let s = String::from_utf16_lossy(std::slice::from_raw_parts(wide_ptr, len));
        let _ = GlobalUnlock(handle);
        Ok(s)
    }
}

pub fn set_clipboard_text(text: &str) -> Result<(), String> {
    unsafe {
        OpenClipboard(None).map_err(|e| format!("OpenClipboard: {e}"))?;
        let _guard = scopeguard::guard((), |_| {
            let _ = CloseClipboard();
        });
        let _ = EmptyClipboard();
        set_unicode_text(text)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::build_cf_html;

    fn read_offset(payload: &str, key: &str) -> usize {
        let prefix = format!("{key}:");
        payload
            .lines()
            .find_map(|line| line.strip_prefix(&prefix))
            .and_then(|value| value.parse::<usize>().ok())
            .expect("offset should exist")
    }

    #[test]
    fn cf_html_offsets_wrap_an_office_compatible_document() {
        let html = build_cf_html(r#"<span style="font-size:14pt;">Texto</span>"#);
        let start_html = read_offset(&html, "StartHTML");
        let end_html = read_offset(&html, "EndHTML");
        let start_fragment = read_offset(&html, "StartFragment");
        let end_fragment = read_offset(&html, "EndFragment");

        assert_eq!(&html.as_bytes()[start_html..start_html + 5], b"<html");
        assert_eq!(end_html, html.as_bytes().len());
        assert!(html[start_html..].contains(r#"xmlns:w="urn:schemas-microsoft-com:office:word""#));
        assert!(html[start_html..].contains(r#"<meta charset="utf-8">"#));
        assert_eq!(
            std::str::from_utf8(&html.as_bytes()[start_fragment..end_fragment]).unwrap(),
            r#"<span style="font-size:14pt;">Texto</span>"#
        );
    }
}
