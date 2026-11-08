// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Enable SharedArrayBuffer in WebKitGTK / JavaScriptCore (required for WhatsApp Web calling)
    unsafe {
        std::env::set_var("JSC_useSharedArrayBuffer", "1");

        // Prefer custom GStreamer plugins (e.g. patched libgstwebrtc) if installed in ~/.local/lib/gstreamer-1.0
        if let Some(home) = std::env::var_os("HOME") {
            let plugin_dir = std::path::PathBuf::from(home).join(".local/lib/gstreamer-1.0");
            if plugin_dir.exists() {
                if let Some(existing) = std::env::var_os("GST_PLUGIN_PATH") {
                    let mut paths = vec![plugin_dir];
                    paths.extend(std::env::split_paths(&existing));
                    if let Ok(joined) = std::env::join_paths(paths) {
                        std::env::set_var("GST_PLUGIN_PATH", joined);
                    }
                } else {
                    std::env::set_var("GST_PLUGIN_PATH", plugin_dir);
                }
            }
        }
    }

    rustapp_lib::run()
}
