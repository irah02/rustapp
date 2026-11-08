// RustApp Desktop Companion Script (WhatsApp Web)
// Features: macOS/WebKit Calling & MediaDevices compatibility, MediaSession stub,
// Notification bridging, Theme Switcher (Catppuccin, Gruvbox, Monochrome OLED, Nord, Default),
// and Zoom shortcuts.

(function () {
  console.log('[RustApp] Companion script initialized');





  // ==========================================
  // 1. CALLING & ENVIRONMENT COMPATIBILITY
  // ==========================================
  // WhatsApp checks navigator.platform and navigator.vendor to verify desktop calling support.
  // Spoofing MacIntel and Apple Computer matches the Safari User-Agent and unlocks desktop WebRTC calling.
  try {
    Object.defineProperty(navigator, 'platform', {
      get: () => 'MacIntel',
      configurable: true,
    });
  } catch (e) {
    console.warn('[RustApp] Could not override navigator.platform:', e);
  }

  try {
    Object.defineProperty(navigator, 'vendor', {
      get: () => 'Apple Computer, Inc.',
      configurable: true,
    });
  } catch (e) {
    console.warn('[RustApp] Could not override navigator.vendor:', e);
  }

  try {
    Object.defineProperty(navigator, 'maxTouchPoints', {
      get: () => 0,
      configurable: true,
    });
  } catch (e) {
    console.warn('[RustApp] Could not override navigator.maxTouchPoints:', e);
  }

  // Ensure WebRTC and legacy aliases are present, and patch GStreamer webrtcbin quirks
  try {
    if (window.RTCPeerConnection) {
      const NativePC = window.RTCPeerConnection;

      function setupConnectionStateSync(pc) {
        let isClosed = false;
        let spoofedConn = null;
        let spoofedIce = null;
        const BAD_STATES = ['disconnected', 'failed', 'closed'];

        const nativeConnDesc = Object.getOwnPropertyDescriptor(NativePC.prototype, 'connectionState');
        const nativeIceDesc = Object.getOwnPropertyDescriptor(NativePC.prototype, 'iceConnectionState');

        function getNativeConn() {
          try {
            return nativeConnDesc ? nativeConnDesc.get.call(pc) : pc.connectionState;
          } catch (_) {
            return 'new';
          }
        }

        function getNativeIce() {
          try {
            return nativeIceDesc ? nativeIceDesc.get.call(pc) : pc.iceConnectionState;
          } catch (_) {
            return 'new';
          }
        }

        Object.defineProperty(pc, 'connectionState', {
          get: function () {
            if (isClosed) return 'closed';
            const native = getNativeConn();
            if (BAD_STATES.includes(native)) return native;
            if (spoofedConn) return spoofedConn;
            return native;
          },
          configurable: true,
        });

        Object.defineProperty(pc, 'iceConnectionState', {
          get: function () {
            if (isClosed) return 'closed';
            const native = getNativeIce();
            if (BAD_STATES.includes(native)) return native;
            if (spoofedIce) return spoofedIce;
            return native;
          },
          configurable: true,
        });

        function markConnected() {
          if (isClosed) return;
          const currentConn = getNativeConn();
          if (currentConn !== 'connected' && spoofedConn !== 'connected') {
            spoofedConn = 'connected';
            spoofedIce = 'connected';
            console.log('[RustApp WebRTC] Data channel active (native: ' + currentConn + '): transitioning connectionState -> connected');
            pc.dispatchEvent(new Event('iceconnectionstatechange'));
            pc.dispatchEvent(new Event('connectionstatechange'));
          }
        }

        function handleChannelClosed() {
          if (!isClosed) {
            spoofedConn = null;
            spoofedIce = null;
          }
        }

        function watchChannel(ch) {
          if (!ch) return;
          ch.addEventListener('open', markConnected);
          ch.addEventListener('close', handleChannelClosed);
          ch.addEventListener('error', handleChannelClosed);
          if (ch.readyState === 'open') {
            markConnected();
          }
        }

        const origCDC = pc.createDataChannel;
        pc.createDataChannel = function () {
          const ch = origCDC.apply(pc, arguments);
          watchChannel(ch);
          return ch;
        };

        pc.addEventListener('datachannel', function (e) {
          watchChannel(e.channel);
        });

        const origClose = pc.close;
        pc.close = function () {
          isClosed = true;
          spoofedConn = 'closed';
          spoofedIce = 'closed';
          return origClose.apply(pc, arguments);
        };
      }

      // Force bundlePolicy: 'max-bundle' because GStreamer webrtcbin only implements max-bundle
      const PCProxy = new Proxy(NativePC, {
        construct(target, args, newTarget) {
          const config = args[0] ? Object.assign({}, args[0]) : {};
          config.bundlePolicy = 'max-bundle';
          args[0] = config;
          const pc = Reflect.construct(target, args, newTarget);
          setupConnectionStateSync(pc);
          return pc;
        },
      });
      PCProxy.prototype = NativePC.prototype;
      try {
        Object.defineProperty(PCProxy, 'name', { value: 'RTCPeerConnection' });
      } catch (_) {}

      // Patch addIceCandidate to ensure sdpMLineIndex is populated if sdpMid is present
      const origAddIceCandidate = NativePC.prototype.addIceCandidate;
      NativePC.prototype.addIceCandidate = function (candidate) {
        if (candidate && (candidate.sdpMLineIndex === null || candidate.sdpMLineIndex === undefined)) {
          if (candidate.sdpMid !== null && candidate.sdpMid !== undefined) {
            const parsedMid = parseInt(candidate.sdpMid, 10);
            const mline = !isNaN(parsedMid) ? parsedMid : 0;
            try {
              if (typeof RTCIceCandidate !== 'undefined') {
                candidate = new RTCIceCandidate({
                  candidate: candidate.candidate,
                  sdpMid: candidate.sdpMid,
                  sdpMLineIndex: mline,
                });
              }
            } catch (_) {}
          }
        }
        return origAddIceCandidate.call(this, candidate);
      };

      window.RTCPeerConnection = PCProxy;
      window.webkitRTCPeerConnection = PCProxy;
    }

    if (window.AudioContext) {
      const OrigAC = window.AudioContext;
      const ACPoly = new Proxy(OrigAC, {
        construct(target, args, newTarget) {
          const ctx = Reflect.construct(target, args, newTarget);
          if (ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
          }
          ctx.addEventListener('statechange', () => {
            console.log('[RustApp Audio] AudioContext state:', ctx.state);
            if (ctx.state === 'suspended') {
              ctx.resume().catch(() => {});
            }
          });
          return ctx;
        },
      });
      ACPoly.prototype = OrigAC.prototype;
      window.AudioContext = ACPoly;
      window.webkitAudioContext = ACPoly;
    }

    if (window.AudioWorkletNode) {
      const OrigAWN = window.AudioWorkletNode;
      const AWNPoly = new Proxy(OrigAWN, {
        construct(target, args, newTarget) {
          const node = Reflect.construct(target, args, newTarget);
          try {
            node.__processorName = args[1] || '';
          } catch (_) {}
          return node;
        },
      });
      AWNPoly.prototype = OrigAWN.prototype;
      window.AudioWorkletNode = AWNPoly;
    }

    // Direct destination bridge: WhatsApp connects AudioWorkletNode -> MediaStreamAudioDestinationNode -> <audio>.
    // In WebKitGTK, MediaStreamDestination -> <audio> playback can stall. Bridging to AudioContext.destination
    // delivers incoming VoIP audio directly to PipeWire/PulseAudio.
    if (window.AudioNode) {
      const origConnect = AudioNode.prototype.connect;
      AudioNode.prototype.connect = function (dest) {
        if (dest && typeof MediaStreamAudioDestinationNode !== 'undefined' && dest instanceof MediaStreamAudioDestinationNode) {
          // Narrow specifically to AudioWorkletNode to avoid echoing microphone input
          if (typeof AudioWorkletNode !== 'undefined' && !(this instanceof AudioWorkletNode)) {
            return origConnect.apply(this, arguments);
          }
          console.log('[RustApp Audio] Bridging AudioWorkletNode (' + (this.__processorName || 'worklet') + ') directly to AudioContext.destination');
          try {
            if (this.context && this.context.state === 'suspended') {
              this.context.resume().catch(() => {});
            }
            origConnect.call(this, this.context.destination);
          } catch (e) {
            console.warn('[RustApp Audio] Bridge to destination failed:', e);
          }
        }
        return origConnect.apply(this, arguments);
      };
    }
  } catch (e) {
    console.warn('[RustApp] Could not bind legacy WebRTC/Audio aliases:', e);
  }

  try {
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const origGUM = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

      navigator.mediaDevices.getUserMedia = async function (constraints) {
        console.log('[RustApp GUM] Requested constraints:', JSON.stringify(constraints));
        try {
          const stream = await origGUM(constraints);
          console.log('[RustApp GUM] Stream acquired successfully with tracks:', stream.getTracks().map((t) => t.kind + ':' + t.label).join(', '));
          return stream;
        } catch (err) {
          console.warn('[RustApp GUM] Initial getUserMedia failed (' + err.name + ': ' + err.message + '), trying relaxed constraints...');
          const relaxed = {};
          if (constraints && constraints.audio) relaxed.audio = true;
          if (constraints && constraints.video) relaxed.video = true;
          try {
            const stream = await origGUM(relaxed);
            console.log('[RustApp GUM] Relaxed stream acquired with tracks:', stream.getTracks().map((t) => t.kind).join(', '));
            return stream;
          } catch (err2) {
            console.error('[RustApp GUM] Relaxed stream also failed:', err2);
            throw err;
          }
        }
      };
      navigator.getUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
      navigator.webkitGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    }
  } catch (e) {
    console.warn('[RustApp] Could not bind getUserMedia and RTCPeerConnection wrappers:', e);
  }

  // Ensure microphone and camera permissions always report as granted so WhatsApp doesn't display
  // the red crossed-out blocked icon on the call button.
  if (navigator.permissions && navigator.permissions.query) {
    try {
      const origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = async function (desc) {
        const name = desc ? desc.name : '';
        if (name === 'microphone' || name === 'camera' || name === 'notifications' || name === 'persistent-storage') {
          class FakeStatus extends EventTarget {
            constructor(permName) {
              super();
              this.name = permName;
              this.state = 'granted';
              this.status = 'granted';
              this.onchange = null;
            }
          }
          if (window.PermissionStatus) {
            try {
              Object.setPrototypeOf(FakeStatus.prototype, window.PermissionStatus.prototype);
            } catch (_) {}
          }
          return new FakeStatus(name);
        }

        try {
          return await origQuery(desc);
        } catch (e) {
          class FakeStatusFallback extends EventTarget {
            constructor(permName) {
              super();
              this.name = permName;
              this.state = 'granted';
              this.status = 'granted';
              this.onchange = null;
            }
          }
          return new FakeStatusFallback(name || 'microphone');
        }
      };
    } catch (e) {
      console.warn('[RustApp] Could not hook permissions.query:', e);
    }
  }

  // Ensure enumerateDevices returns non-empty device labels and at least one audio & video device
  // so WhatsApp knows input hardware is ready and doesn't mark calling as disabled.
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) {
    try {
      const origEnumerate = navigator.mediaDevices.enumerateDevices.bind(navigator.mediaDevices);
      navigator.mediaDevices.enumerateDevices = async function () {
        let devs = [];
        try {
          devs = (await origEnumerate()) || [];
        } catch (err) {
          console.warn('[RustApp] Error calling origEnumerate:', err);
          devs = [];
        }

        let result = devs.map((d, i) => {
          const kind = d.kind;
          const label = d.label || (kind === 'audioinput' ? 'System Microphone (Default)' : kind === 'videoinput' ? 'Webcam (Default)' : 'Audio Output');
          const id = d.deviceId || (kind + '-' + (i + 1));
          return {
            deviceId: id,
            groupId: d.groupId || 'default-group',
            kind: kind,
            label: label,
            toJSON: () => ({
              deviceId: id,
              groupId: d.groupId || 'default-group',
              kind: kind,
              label: label,
            }),
          };
        });

        return result;
      };
    } catch (e) {
      console.warn('[RustApp] Could not hook enumerateDevices:', e);
    }
  }

  // Stubs navigator.mediaSession so WebKitGTK never gets stuck on MPRIS media sessions
  // while allowing WhatsApp audio/call handlers to function normally.
  try {
    if (navigator.mediaSession) {
      const state = {
        metadata: null,
        playbackState: 'none',
      };
      const handlers = new Map();

      const stub = {
        get metadata() {
          return state.metadata;
        },
        set metadata(value) {
          state.metadata = value;
        },
        get playbackState() {
          return state.playbackState;
        },
        set playbackState(value) {
          state.playbackState = value;
        },
        setActionHandler(action, handler) {
          if (handler) handlers.set(action, handler);
          else handlers.delete(action);
        },
        setPositionState() {},
      };

      Object.defineProperty(navigator, 'mediaSession', {
        configurable: true,
        enumerable: true,
        get: () => stub,
        set() {},
      });
    }
  } catch (e) {
    console.warn('[RustApp] Could not stub mediaSession:', e);
  }

  // Safe notification permission reporting
  try {
    const Original = window.Notification;
    if (Original) {
      const Patched = function (title, options) {
        return {
          onclick: null,
          onclose: null,
          onerror: null,
          onshow: null,
          close() {},
          addEventListener() {},
          removeEventListener() {},
        };
      };
      Patched.prototype = Original.prototype;
      Object.defineProperty(Patched, 'permission', { get: () => 'granted', configurable: true });
      Patched.requestPermission = function (callback) {
        if (typeof callback === 'function') callback('granted');
        return Promise.resolve('granted');
      };
      window.Notification = Patched;
    }
  } catch (e) {
    console.warn('[RustApp] Could not patch Notification:', e);
  }

  // ==========================================
  // 2. THEMES DEFINITIONS
  // ==========================================
  const THEMES = {
    'catppuccin-mocha': {
      name: 'Catppuccin Mocha',
      icon: '☕',
      css: `
        :root, body, body.dark {
          --app-background: #181825 !important;
          --app-background-stripe: #11111b !important;
          --conversation-panel-background: #181825 !important;
          --panel-background: #1e1e2e !important;
          --panel-background-lighter: #313244 !important;
          --panel-background-colored: #313244 !important;
          --panel-background-deep: #11111b !important;
          --background-default: #1e1e2e !important;
          --background-default-hover: #313244 !important;
          --background-default-active: #45475a !important;
          --incoming-background: #313244 !important;
          --incoming-background-highlight: #45475a !important;
          --outgoing-background: #45475a !important;
          --outgoing-background-highlight: #585b70 !important;
          --dropdown-background: #1e1e2e !important;
          --modal-background: #1e1e2e !important;
          --primary-strong: #cba6f7 !important;
          --primary: #89b4fa !important;
          --primary-title: #cdd6f4 !important;
          --secondary: #a6adc8 !important;
          --secondary-stronger: #bac2de !important;
          --secondary-lighter: #6c7086 !important;
          --border-default: #313244 !important;
          --border-strong: #45475a !important;
          --border-stronger: #585b70 !important;
          --border-list: #313244 !important;
          --border-panel: #313244 !important;
          --border-bubble: rgba(205, 214, 244, 0.08) !important;
          --compose-primary: #cdd6f4 !important;
          --compose-input-background: #313244 !important;
          --compose-input-border: #45475a !important;
          --icon: #a6adc8 !important;
          --icon-lighter: #6c7086 !important;
          --icon-strong: #cdd6f4 !important;
          --icon-fixed: #a6adc8 !important;
          --unread-marker-background: #cba6f7 !important;
          --unread-bar-background: #313244 !important;
        }
        [data-testid="msg-container"] {
          border-radius: 10px !important;
        }
        span[data-testid="icon-unread-count"] {
          background-color: #cba6f7 !important;
          color: #11111b !important;
          font-weight: bold !important;
        }
      `
    },
    'gruvbox-dark': {
      name: 'Gruvbox Dark',
      icon: '🌲',
      css: `
        :root, body, body.dark {
          --app-background: #1d2021 !important;
          --app-background-stripe: #1d2021 !important;
          --conversation-panel-background: #1d2021 !important;
          --panel-background: #282828 !important;
          --panel-background-lighter: #3c3836 !important;
          --panel-background-colored: #3c3836 !important;
          --panel-background-deep: #1d2021 !important;
          --background-default: #282828 !important;
          --background-default-hover: #3c3836 !important;
          --background-default-active: #504945 !important;
          --incoming-background: #32302f !important;
          --incoming-background-highlight: #3c3836 !important;
          --outgoing-background: #3c3836 !important;
          --outgoing-background-highlight: #504945 !important;
          --dropdown-background: #282828 !important;
          --modal-background: #282828 !important;
          --primary-strong: #b8bb26 !important;
          --primary: #fabd2f !important;
          --primary-title: #ebdbb2 !important;
          --secondary: #a89984 !important;
          --secondary-stronger: #bdae93 !important;
          --secondary-lighter: #7c6f64 !important;
          --border-default: #3c3836 !important;
          --border-strong: #504945 !important;
          --border-stronger: #665c54 !important;
          --border-list: #3c3836 !important;
          --border-panel: #3c3836 !important;
          --border-bubble: rgba(235, 219, 178, 0.08) !important;
          --compose-primary: #ebdbb2 !important;
          --compose-input-background: #32302f !important;
          --compose-input-border: #504945 !important;
          --icon: #a89984 !important;
          --icon-lighter: #7c6f64 !important;
          --icon-strong: #ebdbb2 !important;
          --icon-fixed: #a89984 !important;
          --unread-marker-background: #fabd2f !important;
          --unread-bar-background: #3c3836 !important;
        }
        span[data-testid="icon-unread-count"] {
          background-color: #fabd2f !important;
          color: #1d2021 !important;
          font-weight: bold !important;
        }
      `
    },
    'monochrome-oled': {
      name: 'Monochrome OLED (Uber)',
      icon: '🖤',
      css: `
        :root, body, body.dark {
          --app-background: #000000 !important;
          --app-background-stripe: #000000 !important;
          --conversation-panel-background: #000000 !important;
          --panel-background: #000000 !important;
          --panel-background-lighter: #121212 !important;
          --panel-background-colored: #121212 !important;
          --panel-background-deep: #000000 !important;
          --background-default: #000000 !important;
          --background-default-hover: #171717 !important;
          --background-default-active: #222222 !important;
          --incoming-background: #141414 !important;
          --incoming-background-highlight: #1f1f1f !important;
          --outgoing-background: #242424 !important;
          --outgoing-background-highlight: #303030 !important;
          --dropdown-background: #0a0a0a !important;
          --modal-background: #0a0a0a !important;
          --primary-strong: #ffffff !important;
          --primary: #ffffff !important;
          --primary-title: #ffffff !important;
          --secondary: #888888 !important;
          --secondary-stronger: #cccccc !important;
          --secondary-lighter: #555555 !important;
          --border-default: #1c1c1c !important;
          --border-strong: #262626 !important;
          --border-stronger: #333333 !important;
          --border-list: #1a1a1a !important;
          --border-panel: #1a1a1a !important;
          --border-bubble: rgba(255, 255, 255, 0.08) !important;
          --compose-primary: #ffffff !important;
          --compose-input-background: #111111 !important;
          --compose-input-border: #262626 !important;
          --icon: #888888 !important;
          --icon-lighter: #555555 !important;
          --icon-strong: #ffffff !important;
          --icon-fixed: #888888 !important;
          --unread-marker-background: #ffffff !important;
          --unread-bar-background: #1c1c1c !important;
        }
        #app, [data-testid="chat-list"], [data-testid="conversation-panel-wrapper"] {
          background-color: #000000 !important;
        }
        span[data-testid="icon-unread-count"] {
          background-color: #ffffff !important;
          color: #000000 !important;
          font-weight: 900 !important;
        }
        [data-testid="msg-container"] {
          border: 1px solid #202020 !important;
        }
      `
    },
    'nord': {
      name: 'Nord Night',
      icon: '❄️',
      css: `
        :root, body, body.dark {
          --app-background: #242933 !important;
          --app-background-stripe: #1e222a !important;
          --conversation-panel-background: #242933 !important;
          --panel-background: #2e3440 !important;
          --panel-background-lighter: #3b4252 !important;
          --panel-background-colored: #3b4252 !important;
          --panel-background-deep: #1e222a !important;
          --background-default: #2e3440 !important;
          --background-default-hover: #3b4252 !important;
          --background-default-active: #434c5e !important;
          --incoming-background: #3b4252 !important;
          --incoming-background-highlight: #434c5e !important;
          --outgoing-background: #434c5e !important;
          --outgoing-background-highlight: #4c566a !important;
          --dropdown-background: #2e3440 !important;
          --modal-background: #2e3440 !important;
          --primary-strong: #88c0d0 !important;
          --primary: #81a1c1 !important;
          --primary-title: #eceff4 !important;
          --secondary: #d8dee9 !important;
          --secondary-stronger: #e5e9f0 !important;
          --secondary-lighter: #4c566a !important;
          --border-default: #3b4252 !important;
          --border-strong: #434c5e !important;
          --border-stronger: #4c566a !important;
          --border-list: #3b4252 !important;
          --border-panel: #3b4252 !important;
          --border-bubble: rgba(236, 239, 244, 0.08) !important;
          --compose-primary: #eceff4 !important;
          --compose-input-background: #3b4252 !important;
          --compose-input-border: #434c5e !important;
          --icon: #d8dee9 !important;
          --icon-lighter: #4c566a !important;
          --icon-strong: #eceff4 !important;
          --icon-fixed: #d8dee9 !important;
          --unread-marker-background: #88c0d0 !important;
          --unread-bar-background: #3b4252 !important;
        }
        span[data-testid="icon-unread-count"] {
          background-color: #88c0d0 !important;
          color: #2e3440 !important;
          font-weight: bold !important;
        }
      `
    },
    'default': {
      name: 'Default WhatsApp',
      icon: '💬',
      css: ''
    }
  };

  const THEME_KEYS = Object.keys(THEMES);
  let activeLabelEl = null;

  function updateWidgetActiveLabel(themeKey) {
    if (activeLabelEl && THEMES[themeKey]) {
      activeLabelEl.textContent = `${THEMES[themeKey].icon} ${THEMES[themeKey].name}`;
    }
  }

  function applyTheme(themeKey) {
    if (!THEMES[themeKey]) themeKey = 'catppuccin-mocha';
    try {
      localStorage.setItem('wa_tauri_theme', themeKey);
    } catch (_) {}

    let styleEl = document.getElementById('wa-tauri-theme-style');
    if (!styleEl) {
      const parent = document.head || document.documentElement;
      if (!parent) {
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', () => applyTheme(themeKey), { once: true });
        }
        return;
      }
      styleEl = document.createElement('style');
      styleEl.id = 'wa-tauri-theme-style';
      parent.appendChild(styleEl);
    }

    styleEl.textContent = THEMES[themeKey].css;
    updateWidgetActiveLabel(themeKey);
    console.log(`[RustApp] Applied theme: ${THEMES[themeKey].name}`);
  }

  window.applyTheme = applyTheme;

  function getActiveTheme() {
    return localStorage.getItem('wa_tauri_theme') || 'catppuccin-mocha';
  }

  // Apply saved theme immediately
  applyTheme(getActiveTheme());

  // ==========================================
  // 3. MEDIA PERMISSIONS PROMPT & REQUESTER
  // ==========================================
  async function requestRustAppMediaPermissions() {
    console.log('[RustApp] Requesting microphone & camera permissions via getUserMedia...');
    let stream = null;
    let error = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
    } catch (e1) {
      console.warn('[RustApp] Audio+Video getUserMedia failed, trying audio only:', e1);
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e2) {
        console.error('[RustApp] Audio only getUserMedia failed:', e2);
        error = e2;
      }
    }

    if (stream) {
      const tracks = stream.getTracks();
      console.log('[RustApp] Permissions successfully granted! Tracks:', tracks.map((t) => t.kind));
      tracks.forEach((track) => track.stop());
      try {
        localStorage.setItem('wa_rustapp_media_granted', 'true');
      } catch (_) {}
      if (navigator.mediaDevices && navigator.mediaDevices.dispatchEvent) {
        navigator.mediaDevices.dispatchEvent(new Event('devicechange'));
      }
      return { success: true };
    }
    return { success: false, error: error ? error.message : 'Unknown error' };
  }

  window.requestRustAppMediaPermissions = requestRustAppMediaPermissions;

  function showPermissionBanner() {
    if (localStorage.getItem('wa_rustapp_media_granted') === 'true') return;
    if (document.getElementById('rustapp-perm-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'rustapp-perm-banner';
    banner.style.cssText = `
      position: fixed;
      top: 12px;
      left: 50%;
      transform: translateX(-50%);
      z-index: 9999999;
      background: rgba(30, 30, 46, 0.96);
      color: #cdd6f4;
      border: 1px solid rgba(0, 168, 132, 0.7);
      box-shadow: 0 10px 32px rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(14px);
      -webkit-backdrop-filter: blur(14px);
      border-radius: 12px;
      padding: 10px 18px;
      display: flex;
      align-items: center;
      gap: 14px;
      font-size: 13px;
      font-weight: 500;
      animation: waBannerSlide 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    banner.innerHTML = `
      <style>
        @keyframes waBannerSlide {
          from { opacity: 0; transform: translate(-50%, -20px); }
          to { opacity: 1; transform: translate(-50%, 0); }
        }
        #rustapp-grant-btn {
          background: #00a884;
          color: #ffffff;
          border: none;
          padding: 6px 14px;
          border-radius: 8px;
          font-size: 12px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s ease, transform 0.1s ease;
        }
        #rustapp-grant-btn:hover {
          background: #06cf9c;
          transform: scale(1.03);
        }
        #rustapp-grant-btn:active {
          transform: scale(0.97);
        }
        #rustapp-dismiss-btn {
          background: transparent;
          color: #a6adc8;
          border: none;
          font-size: 16px;
          cursor: pointer;
          padding: 2px 6px;
          border-radius: 4px;
        }
        #rustapp-dismiss-btn:hover {
          color: #ffffff;
          background: rgba(255, 255, 255, 0.1);
        }
      </style>
      <span>🎙️ <b>WhatsApp Call Setup:</b> Approve microphone & camera permissions to enable calling.</span>
      <button id="rustapp-grant-btn">Approve Permissions</button>
      <button id="rustapp-dismiss-btn" title="Dismiss">✕</button>
    `;

    document.body.appendChild(banner);

    const grantBtn = document.getElementById('rustapp-grant-btn');
    const dismissBtn = document.getElementById('rustapp-dismiss-btn');

    grantBtn.addEventListener('click', async (e) => {
      e.stopPropagation();
      grantBtn.textContent = 'Approving...';
      grantBtn.disabled = true;

      const res = await requestRustAppMediaPermissions();
      if (res.success) {
        banner.innerHTML = `<span style="color:#a6e3a1;font-weight:600;">✅ Permissions approved! Voice & video calling are now ready.</span>`;
        setTimeout(() => {
          banner.style.transition = 'opacity 0.4s ease';
          banner.style.opacity = '0';
          setTimeout(() => banner.remove(), 400);
        }, 2200);
      } else {
        banner.innerHTML = `<span style="color:#f38ba8;">⚠️ Request error: ${res.error || 'Failed'}</span>`;
        setTimeout(() => banner.remove(), 4000);
      }
    });

    dismissBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      banner.remove();
    });
  }

  // ==========================================
  // 4. FLOATING THEME SELECTOR WIDGET
  // ==========================================
  function createThemeWidget() {
    if (document.getElementById('wa-tauri-widget-container')) return;

    const container = document.createElement('div');
    container.id = 'wa-tauri-widget-container';
    container.innerHTML = `
      <style>
        #wa-tauri-widget-container {
          position: fixed;
          bottom: 14px;
          left: 14px;
          z-index: 999999;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          user-select: none;
        }
        #wa-tauri-theme-btn {
          background: rgba(20, 20, 20, 0.85);
          backdrop-filter: blur(12px);
          -webkit-backdrop-filter: blur(12px);
          color: #ffffff;
          border: 1px solid rgba(255, 255, 255, 0.16);
          border-radius: 20px;
          padding: 6px 12px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 6px;
          box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
          transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
          opacity: 0.6;
        }
        #wa-tauri-theme-btn:hover {
          opacity: 1;
          transform: translateY(-2px);
          border-color: rgba(255, 255, 255, 0.35);
          box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55);
        }
        #wa-tauri-theme-menu {
          display: none;
          position: absolute;
          bottom: 38px;
          left: 0;
          background: rgba(24, 24, 27, 0.95);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.14);
          border-radius: 12px;
          box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
          min-width: 210px;
          padding: 6px;
          flex-direction: column;
          gap: 2px;
        }
        #wa-tauri-theme-menu.open {
          display: flex;
          animation: waFadeIn 0.18s cubic-bezier(0.16, 1, 0.3, 1);
        }
        @keyframes waFadeIn {
          from { opacity: 0; transform: translateY(6px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .wa-theme-item {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 8px 10px;
          font-size: 13px;
          color: #e4e4e7;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.15s ease, color 0.15s ease;
        }
        .wa-theme-item:hover {
          background: rgba(255, 255, 255, 0.12);
          color: #ffffff;
        }
        .wa-theme-item.active {
          background: rgba(255, 255, 255, 0.2);
          font-weight: 600;
          color: #ffffff;
        }
        .wa-theme-shortcut-hint {
          font-size: 10px;
          color: #71717a;
          margin-top: 4px;
          padding: 4px 8px;
          border-top: 1px solid rgba(255, 255, 255, 0.08);
          text-align: center;
        }
      </style>
      <div id="wa-tauri-theme-btn" title="Toggle Theme (or press Ctrl+Shift+T)">
        <span id="wa-tauri-active-label">🎨 Themes</span>
      </div>
      <div id="wa-tauri-theme-menu">
        ${THEME_KEYS.map((k) => `
          <div class="wa-theme-item ${getActiveTheme() === k ? 'active' : ''}" data-theme="${k}">
            <span>${THEMES[k].icon}</span>
            <span>${THEMES[k].name}</span>
          </div>
        `).join('')}
        <div class="wa-theme-item" id="wa-btn-grant-call-perm" style="border-top: 1px solid rgba(255, 255, 255, 0.08); margin-top: 4px; color: #89b4fa;">
          <span>🎙️</span>
          <span>Approve Call Permissions</span>
        </div>
        <div class="wa-theme-shortcut-hint">Shortcut: Ctrl+Shift+T to cycle</div>
      </div>
    `;

    document.body.appendChild(container);

    const btn = document.getElementById('wa-tauri-theme-btn');
    const menu = document.getElementById('wa-tauri-theme-menu');
    const grantPermBtn = document.getElementById('wa-btn-grant-call-perm');
    activeLabelEl = document.getElementById('wa-tauri-active-label');
    updateWidgetActiveLabel(getActiveTheme());

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      menu.classList.toggle('open');
    });

    if (grantPermBtn) {
      grantPermBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        menu.classList.remove('open');
        const res = await requestRustAppMediaPermissions();
        if (res.success) {
          alert('✅ Permissions approved! Voice and video calls are ready.');
        } else {
          alert('⚠️ Permission prompt failed: ' + (res.error || 'Unknown'));
        }
      });
    }

    document.addEventListener('click', (e) => {
      if (!container.contains(e.target)) {
        menu.classList.remove('open');
      }
    });

    menu.querySelectorAll('.wa-theme-item').forEach((item) => {
      item.addEventListener('click', () => {
        const theme = item.getAttribute('data-theme');
        applyTheme(theme);
        menu.querySelectorAll('.wa-theme-item').forEach((i) => i.classList.remove('active'));
        item.classList.add('active');
        menu.classList.remove('open');
      });
    });
  }

  function initRustAppUI() {
    createThemeWidget();
    showPermissionBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRustAppUI);
  } else {
    initRustAppUI();
  }

  // ==========================================
  // 4. KEYBOARD SHORTCUTS (THEMES & ZOOM)
  // ==========================================
  let currentZoom = 1.0;

  window.addEventListener('keydown', (e) => {
    // Ctrl + Shift + T : Cycle theme
    if (e.ctrlKey && e.shiftKey && (e.key === 'T' || e.key === 't')) {
      e.preventDefault();
      const current = getActiveTheme();
      const nextIdx = (THEME_KEYS.indexOf(current) + 1) % THEME_KEYS.length;
      applyTheme(THEME_KEYS[nextIdx]);
      return;
    }

    // Ctrl + Plus / Ctrl + Equal : Zoom In
    if (e.ctrlKey && (e.key === '=' || e.key === '+')) {
      e.preventDefault();
      currentZoom = Math.min(currentZoom + 0.1, 2.0);
      document.body.style.zoom = currentZoom;
    }

    // Ctrl + Minus : Zoom Out
    if (e.ctrlKey && (e.key === '-' || e.key === '_')) {
      e.preventDefault();
      currentZoom = Math.max(currentZoom - 0.1, 0.6);
      document.body.style.zoom = currentZoom;
    }

    // Ctrl + 0 : Reset Zoom
    if (e.ctrlKey && e.key === '0') {
      e.preventDefault();
      currentZoom = 1.0;
      document.body.style.zoom = currentZoom;
    }
  });

  setInterval(() => {
    if (!document.getElementById('wa-tauri-widget-container')) {
      createThemeWidget();
    }
    if (localStorage.getItem('wa_rustapp_media_granted') !== 'true' && !document.getElementById('rustapp-perm-banner')) {
      showPermissionBanner();
    }
  }, 2500);
})();
