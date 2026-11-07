// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Enable SharedArrayBuffer in WebKitGTK / JavaScriptCore (required for WhatsApp Web calling)
    unsafe {
        std::env::set_var("JSC_useSharedArrayBuffer", "1");
        std::env::set_var("GST_DEBUG", "webrtcbin:4,libnice:4");
    }

    rustapp_lib::run()
}
