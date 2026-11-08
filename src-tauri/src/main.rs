// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn is_gst_plugin_stale(plugin_dir: &std::path::Path) -> bool {
    let meta_file = plugin_dir.join("libgstwebrtc.meta");
    if !meta_file.exists() {
        return false;
    }

    if let Ok(content) = std::fs::read_to_string(&meta_file) {
        let mut sys_path = None;
        let mut recorded_mtime: Option<f64> = None;
        let mut recorded_size: Option<u64> = None;

        for line in content.lines() {
            if let Some((k, v)) = line.split_once('=') {
                match k.trim() {
                    "system_path" => sys_path = Some(v.trim().to_string()),
                    "system_mtime" => recorded_mtime = v.trim().parse().ok(),
                    "system_size" => recorded_size = v.trim().parse().ok(),
                    _ => {}
                }
            }
        }

        if let Some(path_str) = sys_path {
            let p = std::path::Path::new(&path_str);
            if let Ok(meta) = p.metadata() {
                let curr_size = meta.len();
                let curr_mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_secs_f64());

                let size_diff = recorded_size.map_or(false, |s| s != curr_size);
                let mtime_diff = match (recorded_mtime, curr_mtime) {
                    (Some(rec), Some(curr)) => (curr - rec).abs() > 1.0,
                    _ => false,
                };

                return size_diff || mtime_diff;
            }
        }
    }
    false
}

fn main() {
    // Enable SharedArrayBuffer in WebKitGTK / JavaScriptCore (required for WhatsApp Web calling)
    unsafe {
        std::env::set_var("JSC_useSharedArrayBuffer", "1");

        // Prefer custom GStreamer plugins (e.g. patched libgstwebrtc) if installed in ~/.local/lib/gstreamer-1.0
        if let Some(home) = std::env::var_os("HOME") {
            let plugin_dir = std::path::PathBuf::from(home).join(".local/lib/gstreamer-1.0");
            let patched_plugin = plugin_dir.join("libgstwebrtc.so");
            if patched_plugin.exists() {
                let stale = is_gst_plugin_stale(&plugin_dir);

                if stale {
                    eprintln!("[RustApp Warning] System libgstwebrtc.so has changed since the patch was created.");
                    eprintln!("[RustApp Warning] Skipping ~/.local/lib plugin to avoid ABI crashes. Run 'python3 scripts/patch-gst-webrtc.py' to update.");

                    #[cfg(target_os = "linux")]
                    {
                        let _ = notify_rust::Notification::new()
                            .appname("RustApp")
                            .summary("RustApp: GStreamer Plugin Outdated")
                            .body("System GStreamer was upgraded. Run 'python3 scripts/patch-gst-webrtc.py' to refresh calling support.")
                            .icon("rustapp")
                            .show();
                    }
                } else {
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
    }

    rustapp_lib::run()
}
