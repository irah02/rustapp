// RustApp Desktop Companion Script (WhatsApp Web)
// Features: macOS/WebKit Calling & MediaDevices compatibility, MediaSession stub,
// Notification bridging, Permission banner, and Zoom shortcuts.

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

  // ==========================================
  // SCTP & DATA CHANNEL KEEP-ALIVE STABILITY
  // ==========================================
  const globalActiveDataChannels = new Set();
  function hasActiveDataChannels() {
    for (const ch of globalActiveDataChannels) {
      if (ch.readyState === 'open') return true;
    }
    return false;
  }

  // Intercept 20s SCTP connection timeout watchdog:
  // WhatsApp sets a 20s watchdog timer in WAWebVoipSctpConnectionManager that drops the call
  // if s.state is still 'Connecting'. When our media / data channel is active, suppress this watchdog.
  try {
    const origSetTimeout = window.setTimeout;
    window.setTimeout = function (fn, delay) {
      if (typeof fn === 'function' && delay >= 19000 && delay <= 21000) {
        const fnStr = fn.toString();
        if (fnStr.includes('connection_timeout') || fnStr.includes('Connecting')) {
          console.log('[RustApp WebRTC] Intercepted 20s connection_timeout watchdog timer');
          const guarded = function () {
            if (hasActiveDataChannels()) {
              console.warn('[RustApp WebRTC] Suppressed 20s connection_timeout watchdog because data channel is active!');
              return;
            }
            return fn.apply(this, arguments);
          };
          return origSetTimeout.call(this, guarded, delay);
        }
      }
      return origSetTimeout.apply(this, arguments);
    };
  } catch (e) {
    console.warn('[RustApp] Could not wrap setTimeout:', e);
  }

  // Disable transferring RTCDataChannel across threads:
  // In WebKitGTK with GStreamer webrtcbin, SCTP is bound to the main GLib thread.
  // Transferring RTCDataChannel into a Web Worker pthread causes WhatsApp's worker
  // not to receive events, leaving the connection state in 'Connecting' and triggering a timeout drop.
  // When transfer throws DataCloneError, WhatsApp cleanly falls back to its built-in main-thread handlers.
  function checkDataChannelTransfer(transfer) {
    if (transfer && Array.isArray(transfer)) {
      for (const item of transfer) {
        if (item && (item instanceof RTCDataChannel || (item.constructor && item.constructor.name === 'RTCDataChannel'))) {
          throw new DOMException('RTCDataChannel transfer is not supported', 'DataCloneError');
        }
      }
    }
  }

  try {
    if (typeof MessagePort !== 'undefined' && MessagePort.prototype.postMessage) {
      const origMPPostMessage = MessagePort.prototype.postMessage;
      MessagePort.prototype.postMessage = function (message, transfer) {
        if (arguments.length > 1) checkDataChannelTransfer(arguments[1]);
        return origMPPostMessage.apply(this, arguments);
      };
    }
    if (typeof Worker !== 'undefined' && Worker.prototype.postMessage) {
      const origWorkerPostMessage = Worker.prototype.postMessage;
      Worker.prototype.postMessage = function (message, transfer) {
        if (arguments.length > 1) checkDataChannelTransfer(arguments[1]);
        return origWorkerPostMessage.apply(this, arguments);
      };
    }
  } catch (e) {
    console.warn('[RustApp] Could not wrap postMessage transfer check:', e);
  }

  // Ensure late onopen handler assignments fire if RTCDataChannel is already open:
  // In WebKit, if a pre-negotiated channel opens before WhatsApp attaches ch.onopen,
  // standard DOM EventTarget will not re-fire onopen. This guarantees WhatsApp's gt() handler runs.
  try {
    if (typeof RTCDataChannel !== 'undefined' && RTCDataChannel.prototype) {
      const origOnopenDesc = Object.getOwnPropertyDescriptor(RTCDataChannel.prototype, 'onopen');
      if (origOnopenDesc && origOnopenDesc.set) {
        Object.defineProperty(RTCDataChannel.prototype, 'onopen', {
          set: function (fn) {
            origOnopenDesc.set.call(this, fn);
            if (typeof fn === 'function' && this.readyState === 'open') {
              console.log('[RustApp WebRTC] Channel ' + this.label + ' already open when onopen assigned; queueing open event');
              queueMicrotask(() => {
                try {
                  fn.call(this, new Event('open'));
                } catch (err) {
                  console.error('[RustApp WebRTC] onopen handler threw:', err);
                }
              });
            }
          },
          get: function () {
            return origOnopenDesc.get.call(this);
          },
          configurable: true,
          enumerable: true,
        });
      }
    }
  } catch (e) {
    console.warn('[RustApp] Could not wrap RTCDataChannel.onopen:', e);
  }

  // Ensure WebRTC and legacy aliases are present, and patch GStreamer webrtcbin quirks
  try {
    if (window.RTCPeerConnection) {
      const NativePC = window.RTCPeerConnection;

      function setupConnectionStateSync(pc) {
        let isClosed = false;
        let spoofedConn = null;
        let spoofedIce = null;

        const nativeConnDesc = Object.getOwnPropertyDescriptor(NativePC.prototype, 'connectionState');
        const nativeIceDesc = Object.getOwnPropertyDescriptor(NativePC.prototype, 'iceConnectionState');

        function getNativeConn() {
          try {
            return nativeConnDesc ? nativeConnDesc.get.call(pc) : 'new';
          } catch (_) {
            return 'new';
          }
        }

        function getNativeIce() {
          try {
            return nativeIceDesc ? nativeIceDesc.get.call(pc) : 'new';
          } catch (_) {
            return 'new';
          }
        }

        Object.defineProperty(pc, 'connectionState', {
          get: function () {
            if (isClosed) return 'closed';
            if (spoofedConn) return spoofedConn;
            return getNativeConn();
          },
          configurable: true,
        });

        Object.defineProperty(pc, 'iceConnectionState', {
          get: function () {
            if (isClosed) return 'closed';
            if (spoofedIce) return spoofedIce;
            return getNativeIce();
          },
          configurable: true,
        });

        function markConnected(source) {
          if (isClosed) return;
          const currentConn = getNativeConn();
          const currentIce = getNativeIce();
          spoofedConn = 'connected';
          spoofedIce = 'connected';
          console.log('[RustApp WebRTC] Ensuring connected state via ' + (source || 'dc') + ' (native conn=' + currentConn + ', ice=' + currentIce + ')');
          pc.dispatchEvent(new Event('iceconnectionstatechange'));
          pc.dispatchEvent(new Event('connectionstatechange'));
        }

        function watchChannel(ch) {
          if (!ch) return;
          console.log('[RustApp WebRTC] Data channel registered: label=' + ch.label + ', id=' + ch.id + ', readyState=' + ch.readyState);
          let rxCount = 0;
          globalActiveDataChannels.add(ch);
          ch.addEventListener('open', () => {
            console.log('[RustApp WebRTC] Data channel OPEN: ' + ch.label);
            globalActiveDataChannels.add(ch);
            markConnected('dc-open:' + ch.label);
          });
          ch.addEventListener('close', () => {
            globalActiveDataChannels.delete(ch);
            console.warn('[RustApp WebRTC] Data channel CLOSED: ' + ch.label + ' (rxMsgs=' + rxCount + ')');
          });
          ch.addEventListener('error', (e) => {
            console.error('[RustApp WebRTC] Data channel ERROR: ' + ch.label, e);
          });
          ch.addEventListener('message', () => {
            rxCount++;
            globalActiveDataChannels.add(ch);
            if (rxCount === 1 || rxCount % 200 === 0) {
              console.log('[RustApp WebRTC] Data channel ' + ch.label + ' active, rxMsgs=' + rxCount);
            }
          });
          if (ch.readyState === 'open') {
            globalActiveDataChannels.add(ch);
            markConnected('dc-already-open:' + ch.label);
          }
        }

        const origCDC = pc.createDataChannel;
        pc.createDataChannel = function () {
          console.log('[RustApp WebRTC] createDataChannel called: label=' + arguments[0]);
          const ch = origCDC.apply(pc, arguments);
          watchChannel(ch);
          return ch;
        };

        pc.addEventListener('datachannel', function (e) {
          console.log('[RustApp WebRTC] datachannel event received: label=' + (e.channel && e.channel.label));
          watchChannel(e.channel);
        });

        pc.addEventListener('connectionstatechange', function () {
          console.log('[RustApp WebRTC] native connectionstatechange -> ' + getNativeConn() + ' (reported: ' + pc.connectionState + ')');
        });

        pc.addEventListener('iceconnectionstatechange', function () {
          console.log('[RustApp WebRTC] native iceconnectionstatechange -> ' + getNativeIce() + ' (reported: ' + pc.iceConnectionState + ')');
        });

        pc.addEventListener('signalingstatechange', function () {
          console.log('[RustApp WebRTC] signalingstatechange -> ' + pc.signalingState);
        });

        pc.addEventListener('icegatheringstatechange', function () {
          console.log('[RustApp WebRTC] icegatheringstatechange -> ' + pc.iceGatheringState);
        });

        const origClose = pc.close;
        pc.close = function () {
          console.warn('[RustApp WebRTC] pc.close() called! Call stack:\n' + (new Error().stack || ''));
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
          console.log('[RustApp WebRTC] new RTCPeerConnection(bundlePolicy=max-bundle)');
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
        const repr = candidate ? (candidate.candidate ? candidate.candidate.substring(0, 45) + '... (mid=' + candidate.sdpMid + ')' : '[end-of-candidates]') : 'null';
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
        return origAddIceCandidate.call(this, candidate)
          .catch((err) => {
            console.warn('[RustApp WebRTC] addIceCandidate rejected (' + repr + '):', err);
            throw err;
          });
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
      const origACClose = OrigAC.prototype.close;
      OrigAC.prototype.close = function () {
        console.warn('[RustApp Audio] AudioContext.close() called! Call stack:\n' + (new Error().stack || ''));
        return origACClose.apply(this, arguments);
      };
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

      function monitorTracks(stream) {
        if (!stream) return;
        stream.getTracks().forEach((t) => {
          t.addEventListener('ended', () => console.warn('[RustApp Media] Track ENDED: ' + t.kind + ' (' + t.label + ')'));
          t.addEventListener('mute', () => console.warn('[RustApp Media] Track MUTED: ' + t.kind + ' (' + t.label + ')'));
          t.addEventListener('unmute', () => console.log('[RustApp Media] Track UNMUTED: ' + t.kind + ' (' + t.label + ')'));
        });
      }

      navigator.mediaDevices.getUserMedia = async function (constraints) {
        console.log('[RustApp GUM] Requested constraints:', JSON.stringify(constraints));
        try {
          const stream = await origGUM(constraints);
          console.log('[RustApp GUM] Stream acquired successfully with tracks:', stream.getTracks().map((t) => t.kind + ':' + t.label).join(', '));
          monitorTracks(stream);
          return stream;
        } catch (err) {
          console.warn('[RustApp GUM] Initial getUserMedia failed (' + err.name + ': ' + err.message + '), trying relaxed constraints...');
          const relaxed = {};
          if (constraints && constraints.audio) relaxed.audio = true;
          if (constraints && constraints.video) relaxed.video = true;
          try {
            const stream = await origGUM(relaxed);
            console.log('[RustApp GUM] Relaxed stream acquired with tracks:', stream.getTracks().map((t) => t.kind).join(', '));
            monitorTracks(stream);
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

  // Clean up any legacy injected theme styles or widget
  try {
    const legacyStyle = document.getElementById('wa-tauri-theme-style');
    if (legacyStyle) legacyStyle.remove();
    const legacyWidget = document.getElementById('wa-tauri-widget-container');
    if (legacyWidget) legacyWidget.remove();
    localStorage.removeItem('wa_tauri_theme');
  } catch (_) {}

  // ==========================================
  // 3. MEDIA PERMISSIONS PROMPT & REQUESTER
  // ==========================================
  let permInterval = null;

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
        if (permInterval) {
          clearInterval(permInterval);
          permInterval = null;
        }
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
    if (window.opener) return;
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

  function initRustAppUI() {
    showPermissionBanner();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initRustAppUI);
  } else {
    initRustAppUI();
  }

  // ==========================================
  // 4. KEYBOARD SHORTCUTS (ZOOM)
  // ==========================================
  let currentZoom = 1.0;

  window.addEventListener('keydown', (e) => {
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

  // Only poll for permission setup until granted, then cancel timer completely to avoid idle wake-ups
  function checkPermBanner() {
    if (localStorage.getItem('wa_rustapp_media_granted') === 'true') {
      if (permInterval) {
        clearInterval(permInterval);
        permInterval = null;
      }
      return;
    }
    if (!document.getElementById('rustapp-perm-banner')) {
      showPermissionBanner();
    }
  }

  if (localStorage.getItem('wa_rustapp_media_granted') !== 'true' && !window.opener) {
    permInterval = setInterval(checkPermBanner, 2500);
  }
})();
