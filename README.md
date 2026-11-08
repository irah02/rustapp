# RustApp 🦀📱

A blazing-fast, lightweight (~8 MB binary, ~70 MB RAM) native desktop client for WhatsApp Web built with Rust, Tauri v2, and WebKitGTK.

---

## Features

- **Blazing Fast & Low Memory**: Pure native client on WebKitGTK — uses a fraction of the RAM consumed by Electron or Chrome tabs.
- **Voice & Video Calls (WebRTC)**:
  - Full WebRTC, MediaStream, and MediaSource engine support enabled.
  - Automatic microphone and webcam permissions negotiation for direct calling.
  - Background audio & ringtone playback allowed (`media_playback_requires_user_gesture = false`).
- **Native Freedesktop Notifications**:
  - Direct integration with Linux DBus (`org.freedesktop.Notifications`) for full compatibility with Hyprland (`dunst`, `mako`, `swaync`), GNOME, KDE Plasma, and XFCE.
  - Clicking on an incoming notification automatically unminimizes and focuses the window.
- **Custom Curated Dark Themes**:
  - **Catppuccin Mocha** (Muted purples, soft blues, and dark pastel tones)
  - **Gruvbox Dark** (Warm retro dark tones with yellow and green accents)
  - **Monochrome OLED (Uber style)** (Pure `#000000` pitch black, high-contrast white text and crisp borders)
  - **Nord Night** (Arctic bluish dark palette)
  - **Default WhatsApp** (Stock WhatsApp dark/light mode)
- **Theme Switcher**:
  - Floating pill widget in the bottom-left corner with 1-click theme picker.
  - Keyboard shortcut: <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>T</kbd> cycles through all themes instantly.
  - Themes can also be selected from the System Tray right-click context menu.
  - Active theme preference is persisted in LocalStorage across restarts.
- **System Tray & Window Management**:
  - Close-to-tray: Closing the window with the 'X' button hides it to the system tray so calls and messages keep syncing in the background.
  - Left-click tray icon: Show / Hide window.
  - Right-click tray menu: Show / Hide, Themes submenu, Reload, and Quit.
- **Zoom Controls**:
  - <kbd>Ctrl</kbd> + <kbd>+</kbd> / <kbd>=</kbd>: Zoom In
  - <kbd>Ctrl</kbd> + <kbd>-</kbd>: Zoom Out
  - <kbd>Ctrl</kbd> + <kbd>0</kbd>: Reset Zoom

---

## Launching

`RustApp` is installed in your user PATH:

- **From Application Launcher** (Rofi, Wofi, Anyrun, Application Menu):
  Search for `RustApp`.
- **From Terminal**:
  ```bash
  rustapp
  ```
- **From Hyprland config (`~/.config/hypr/hyprland.conf`)**:
  ```ini
  bind = $mainMod, W, exec, rustapp
  ```

---

## Development & Building

### Prerequisites for WhatsApp Calling (Linux)
1. **WebKitGTK 4.1 compiled with WebRTC**:
   Ensure `webkit2gtk-4.1` is installed with `-DENABLE_WEB_RTC=ON`, `-DENABLE_MEDIA_STREAM=ON`, and `-DUSE_GSTREAMER_WEBRTC=ON`.
2. **GStreamer WebRTC ICE Patch**:
   WhatsApp Web uses Base64 encoded ICE credentials ending in `=` / `==`, which strict RFC 5245 validation in GStreamer rejects. Apply the local user plugin patch with:
   ```bash
   python3 scripts/patch-gst-webrtc.py
   ```
   This creates a patched `libgstwebrtc.so` in `~/.local/lib/gstreamer-1.0` that RustApp prioritizes automatically.

### Building
To run in development mode:
```bash
cd ~/Projects/rustapp
npm run tauri dev
```

To build the release binary:
```bash
cd ~/Projects/rustapp/src-tauri
cargo build --release
```
The optimized release binary is located at `src-tauri/target/release/rustapp` (~8 MB).
