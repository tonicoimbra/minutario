use std::thread;
use std::time::Duration;
use windows::Win32::UI::Input::KeyboardAndMouse::*;

unsafe fn make_kbd_input(vk: u16, flags: KEYBD_EVENT_FLAGS) -> INPUT {
    let mut input = INPUT::default();
    input.r#type = INPUT_KEYBOARD;
    input.Anonymous.ki = KEYBDINPUT {
        wVk: VIRTUAL_KEY(vk),
        wScan: 0,
        dwFlags: flags,
        time: 0,
        dwExtraInfo: 0,
    };
    input
}

unsafe fn send_inputs(inputs: &[INPUT]) {
    SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
}

pub fn simulate_backspace(count: usize) {
    let vk: u16 = VK_BACK.0 as u16;
    for _ in 0..count {
        thread::sleep(Duration::from_millis(5));
        unsafe {
            let down = make_kbd_input(vk, KEYBD_EVENT_FLAGS(0));
            let up = make_kbd_input(vk, KEYEVENTF_KEYUP);
            send_inputs(&[down, up]);
        }
    }
}

pub fn simulate_paste() {
    thread::sleep(Duration::from_millis(20));
    unsafe {
        let ctrl: u16 = VK_CONTROL.0 as u16;
        let v: u16 = 0x56;
        let no_flags = KEYBD_EVENT_FLAGS(0);
        let up_flags = KEYEVENTF_KEYUP;

        let inputs = [
            make_kbd_input(ctrl, no_flags),
            make_kbd_input(v, no_flags),
            make_kbd_input(v, up_flags),
            make_kbd_input(ctrl, up_flags),
        ];
        send_inputs(&inputs);
    }
}
