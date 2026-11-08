// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    // Enable SharedArrayBuffer in WebKitGTK / JavaScriptCore (required for WhatsApp Web calling)
    unsafe {
        std::env::set_var("JSC_useSharedArrayBuffer", "1");

        // Prefer custom GStreamer plugins (e.g. patched libgstwebrtc) if installed in ~/.local/lib/gstreamer-1.0
        if let Some(home) = std::env::var_os("HOME") {
            let plugin_dir = std::path::PathBuf::from(home).join(".local/lib/gstreamer-1.0");
            let patched_plugin = plugin_dir.join("libgstwebrtc.so");
            if patched_plugin.exists() {
                // Check if system plugin is newer (e.g. after a pacman -Syu upgrade)
                let system_plugin = std::path::Path::new("/usr/lib/gstreamer-1.0/libgstwebrtc.so");
                if let (Ok(p_meta), Ok(s_meta)) = (patched_plugin.metadata(), system_plugin.metadata()) {
                    if let (Ok(p_mtime), Ok(s_mtime)) = (p_meta.modified(), s_meta.modified()) {
                        if s_mtime > p_mtime {
                            eprintln!("[RustApp Warning] System libgstwebrtc.so is newer than ~/.local/lib/gstreamer-1.0/libgstwebrtc.so.");
                            eprintln!("[RustApp Warning] Please re-run: python3 scripts/patch-gst-webrtc.py");
                        }
                    }
                }

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
