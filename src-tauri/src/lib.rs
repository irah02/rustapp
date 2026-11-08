const INJECTED_SCRIPT: &str = include_str!("injected.js");

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
            use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
            use tauri::Manager;

            let show_item = MenuItem::with_id(app, "show", "Show / Hide", true, None::<&str>)?;
            let reload_item = MenuItem::with_id(app, "reload", "Reload", true, None::<&str>)?;
            let grant_perm_item = MenuItem::with_id(app, "grant_perm", "🎙️ Approve Call Permissions", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit RustApp", true, None::<&str>)?;

            let menu = Menu::with_items(
                app,
                &[
                    &show_item,
                    &reload_item,
                    &grant_perm_item,
                    &sep,
                    &quit_item,
                ],
            )?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&menu)
                .show_menu_on_left_click(false)
                .tooltip("RustApp (WhatsApp)")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "show" => {
                            if let Some(win) = app.get_webview_window("main") {
                                if win.is_visible().unwrap_or(false) {
                                    let _ = win.hide();
                                } else {
                                    let _ = win.show();
                                    let _ = win.unminimize();
                                    let _ = win.set_focus();
                                }
                            }
                        }
                        "reload" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.eval("window.location.reload()");
                            }
                        }
                        "grant_perm" => {
                            if let Some(win) = app.get_webview_window("main") {
                                let _ = win.eval("if (window.requestRustAppMediaPermissions) window.requestRustAppMediaPermissions();");
                            }
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(win) = app.get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
                            } else {
                                let _ = win.show();
                                let _ = win.unminimize();
                                let _ = win.set_focus();
                            }
                        }
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder.build(app)?;

            let window = tauri::WebviewWindowBuilder::from_config(app.handle(), &app.config().app.windows[0])?
                .initialization_script(INJECTED_SCRIPT)
                .build()?;

            #[cfg(target_os = "linux")]
            {
                use webkit2gtk::{
                    NotificationExt, PermissionRequestExt, SettingsExt, WebViewExt,
                };

                let app_handle = app.handle().clone();
                let _ = window.with_webview(move |webview| {
                    let wv = webview.inner();

                    // Enable WebRTC, MediaStreams, WebGL, and MediaSource for Calls and Video Calls
                    if let Some(settings) = wv.settings() {
                        let is_debug = cfg!(debug_assertions) || std::env::var("RUSTAPP_DEBUG").is_ok();

                        settings.set_enable_webrtc(true);
                        settings.set_enable_media_stream(true);
                        settings.set_enable_mediasource(true);
                        settings.set_enable_webgl(true);
                        settings.set_enable_encrypted_media(true);
                        settings.set_enable_media_capabilities(true);
                        settings.set_hardware_acceleration_policy(webkit2gtk::HardwareAccelerationPolicy::Always);
                        settings.set_media_playback_requires_user_gesture(false);
                        settings.set_enable_developer_extras(true);
                        settings.set_enable_write_console_messages_to_stdout(is_debug);
                        settings.set_enable_smooth_scrolling(true);
                        settings.set_enable_dns_prefetching(true);
                        settings.set_enable_back_forward_navigation_gestures(false);
                        settings.set_user_agent(Some("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.6 Safari/605.1.15"));
                    }

                    // Automatically grant camera and microphone permissions for voice & video calls
                    wv.connect_permission_request(|_wv, req| {
                        println!("[RustApp WebKit] PermissionRequest received and allowed");
                        req.allow();
                        true
                    });

                    // Bridge WebKit notifications to Freedesktop native Linux notifications
                    let handle_clone = app_handle.clone();
                    wv.connect_show_notification(move |_wv, notif| {
                        let title = notif.title().map(|s| s.to_string()).unwrap_or_else(|| "WhatsApp".into());
                        let body = notif.body().map(|s| s.to_string()).unwrap_or_default();
                        let h = handle_clone.clone();

                        std::thread::spawn(move || {
                            use notify_rust::{Notification, Timeout};
                            let notif_res = Notification::new()
                                .appname("RustApp")
                                .summary(&title)
                                .body(&body)
                                .icon("rustapp")
                                .timeout(Timeout::Milliseconds(6000))
                                .action("default", "Open RustApp")
                                .show();

                            if let Ok(handle) = notif_res {
                                handle.wait_for_action(move |action| {
                                    if action == "default" {
                                        if let Some(win) = h.get_webview_window("main") {
                                            let _ = win.show();
                                            let _ = win.unminimize();
                                            let _ = win.set_focus();
                                        }
                                    }
                                });
                            }
                        });
                        true
                    });
                });
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
