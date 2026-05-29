import React, { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Mic, MicOff, Square, Hand, Radio, Wifi, WifiOff, RotateCcw,
  Volume2, VolumeX, Activity, AlertCircle,
} from "lucide-react";
import AppShell from "../components/AppShell";
import { PageHeader } from "../components/Shared";
import { toast } from "sonner";

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const WS_URL = `${BACKEND.replace(/^http/, "ws")}/api/voice/ws`;

const COMMANDS = ["done", "next", "repeat", "show again", "i'm stuck", "zoom in", "explain slower"];

const StatusPill = ({ ok, label, icon: Icon }) => (
  <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] border ${
    ok ? "border-emerald-400/40 bg-emerald-500/10 text-emerald-300" : "border-white/10 text-white/40"
  }`}>
    <Icon size={11}/>{label}
  </div>
);

const WaveformBars = ({ level = 0, speaking = false }) => {
  // 24 animated bars driven by mic level + a baseline when assistant speaks
  const bars = Array.from({ length: 24 });
  return (
    <div className="flex items-end justify-center gap-1 h-16">
      {bars.map((_, i) => {
        const phase = (Date.now() / 200 + i * 0.4) % (Math.PI * 2);
        const wave = speaking ? (0.5 + 0.5 * Math.sin(phase)) : 0;
        const h = Math.max(0.08, Math.min(1, level * 4 + wave * 0.6 + Math.random() * 0.05));
        return (
          <motion.span
            key={i}
            animate={{ height: `${h * 100}%` }}
            transition={{ duration: 0.08 }}
            className="w-[6px] rounded-full"
            style={{
              background: speaking
                ? `linear-gradient(180deg, #10b981, #14b8a6)`
                : `linear-gradient(180deg, #ec4899, #a78bfa)`,
              boxShadow: speaking
                ? `0 0 8px rgba(16,185,129,${0.4 + h * 0.5})`
                : `0 0 8px rgba(236,72,153,${0.3 + h * 0.4})`,
            }}
          />
        );
      })}
    </div>
  );
};

const Voice = () => {
  const [mode, setMode] = useState("handsfree");  // 'handsfree' | 'ptt'
  const [connected, setConnected] = useState(false);
  const [connState, setConnState] = useState("idle"); // idle|connecting|live|reconnecting|error
  const [permission, setPermission] = useState("unknown");
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [level, setLevel] = useState(0);
  const [latencyMs, setLatencyMs] = useState(null);
  const [captions, setCaptions] = useState([]); // {role, text, t}
  const [error, setError] = useState("");
  const [devices, setDevices] = useState([]);
  const [activeDevice, setActiveDevice] = useState("");

  const wsRef = useRef(null);
  const audioCtxRef = useRef(null);
  const micStreamRef = useRef(null);
  const micNodeRef = useRef(null);
  const playNodeRef = useRef(null);
  const sourceNodeRef = useRef(null);
  const reconnectTimer = useRef(null);
  const shouldReconnect = useRef(true);
  const vadState = useRef({ speaking: false, silenceMs: 0, lastSpeechAt: 0, lastUserTurnAt: 0 });
  const lastSentAt = useRef(0);
  const ptt = useRef(false);

  /* ---------- token ---------- */
  const token = typeof window !== "undefined" ? localStorage.getItem("ms_token") : "";

  /* ---------- audio init ---------- */
  const initAudio = useCallback(async () => {
    if (audioCtxRef.current) return audioCtxRef.current;
    const AC = window.AudioContext || window.webkitAudioContext;
    const ctx = new AC({ latencyHint: "interactive" });
    if (ctx.state === "suspended") await ctx.resume();
    await ctx.audioWorklet.addModule("/audio-worklets/mic-capture.js");
    await ctx.audioWorklet.addModule("/audio-worklets/pcm-playback.js");
    audioCtxRef.current = ctx;

    // Playback node (assistant audio @24kHz → resampled to ctx rate)
    const playNode = new AudioWorkletNode(ctx, "pcm-playback", {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { inSampleRate: 24000 },
    });
    playNode.port.onmessage = (e) => {
      if (e.data?.type === "drained") setSpeaking(false);
    };
    playNode.connect(ctx.destination);
    playNodeRef.current = playNode;
    return ctx;
  }, []);

  const ensureMic = useCallback(async (deviceId) => {
    if (micStreamRef.current && !deviceId) return micStreamRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 48000,
        },
        video: false,
      });
      setPermission("granted");
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach(t => t.stop());
      }
      micStreamRef.current = stream;
      // device list
      try {
        const list = await navigator.mediaDevices.enumerateDevices();
        const ins = list.filter(d => d.kind === "audioinput");
        setDevices(ins);
        setActiveDevice(ins[0]?.deviceId || "");
      } catch {}
      return stream;
    } catch (e) {
      setPermission("denied");
      throw e;
    }
  }, []);

  const wireMicNode = useCallback(async () => {
    const ctx = audioCtxRef.current;
    const stream = micStreamRef.current;
    if (!ctx || !stream) return;
    // tear old
    try { sourceNodeRef.current?.disconnect(); } catch {}
    try { micNodeRef.current?.disconnect(); } catch {}
    const source = ctx.createMediaStreamSource(stream);
    const mic = new AudioWorkletNode(ctx, "mic-capture", {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { targetSampleRate: 16000 },
    });
    mic.port.onmessage = onMicMessage;
    source.connect(mic);
    // do NOT connect mic to destination
    sourceNodeRef.current = source;
    micNodeRef.current = mic;
  }, []);

  /* ---------- VAD + send loop ---------- */
  const onMicMessage = useCallback((e) => {
    const d = e.data || {};
    if (d.type === "level") {
      setLevel(d.rms);
      const now = performance.now();
      const speakingNow = d.rms > 0.025;
      const s = vadState.current;
      if (mode === "handsfree") {
        if (speakingNow) {
          s.lastSpeechAt = now;
          if (!s.speaking) {
            s.speaking = true;
            // user started → interrupt assistant if needed
            try { playNodeRef.current?.port.postMessage({ type: "flush" }); } catch {}
            setSpeaking(false);
            wsSend({ type: "activity_start" });
          }
        } else if (s.speaking) {
          if (now - s.lastSpeechAt > 600) {
            s.speaking = false;
            wsSend({ type: "activity_end" });
          }
        }
      }
      return;
    }
    if (d.type === "chunk" && d.pcm) {
      // send audio (PTT requires ptt=true; handsfree always sends)
      if (mode === "ptt" && !ptt.current) return;
      const bytes = new Uint8Array(d.pcm);
      // base64 encode
      let bin = ""; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      const b64 = btoa(bin);
      wsSend({ type: "audio", data: b64 });
      lastSentAt.current = performance.now();
    }
  }, [mode]);

  /* ---------- websocket ---------- */
  const wsSend = (obj) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  const connect = useCallback(() => {
    if (!token) { setError("Sign in required"); return; }
    setConnState("connecting"); setError("");
    const url = `${WS_URL}?token=${encodeURIComponent(token)}`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => {
      setConnected(true); setConnState("live");
      setListening(true);
      // periodic ping for latency
      const pingTimer = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) { clearInterval(pingTimer); return; }
        const t0 = performance.now();
        ws._pingAt = t0;
        ws.send(JSON.stringify({ type: "ping" }));
      }, 4000);
      ws._pingTimer = pingTimer;
    };

    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.type === "setup_complete") return;
      if (m.type === "pong") {
        if (ws._pingAt) setLatencyMs(Math.round(performance.now() - ws._pingAt));
        return;
      }
      if (m.type === "audio" && m.data) {
        // decode base64 → ArrayBuffer
        const bin = atob(m.data);
        const buf = new ArrayBuffer(bin.length);
        const u8 = new Uint8Array(buf);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        if (!muted && playNodeRef.current) {
          playNodeRef.current.port.postMessage({ type: "chunk", pcm: buf }, [buf]);
          setSpeaking(true);
        }
        // measure ttf-audio after a user audio chunk was just sent
        if (lastSentAt.current) {
          const dt = performance.now() - lastSentAt.current;
          if (dt < 5000) setLatencyMs(Math.round(dt));
          lastSentAt.current = 0;
        }
        return;
      }
      if (m.type === "text" && m.text) {
        setCaptions((c) => [...c.slice(-30), { role: m.role || "assistant", text: m.text, t: Date.now() }]);
        // command detection on user transcript
        if (m.role === "user") {
          const low = m.text.toLowerCase();
          if (COMMANDS.some(c => low.includes(c))) {
            // The assistant will hear & respond — we just flash a UI hint
            toast.success(`heard command: "${low.match(new RegExp(COMMANDS.join("|")))?.[0]}"`);
          }
        }
        return;
      }
      if (m.type === "interrupted") {
        try { playNodeRef.current?.port.postMessage({ type: "flush" }); } catch {}
        setSpeaking(false);
        return;
      }
      if (m.type === "turn_complete") {
        setSpeaking(false);
        return;
      }
      if (m.type === "error") {
        setError(m.error || "stream error");
        setConnState("error");
      }
    };

    ws.onclose = () => {
      clearInterval(ws._pingTimer);
      setConnected(false); setListening(false); setSpeaking(false);
      if (shouldReconnect.current) {
        setConnState("reconnecting");
        clearTimeout(reconnectTimer.current);
        reconnectTimer.current = setTimeout(() => connect(), 1500);
      } else {
        setConnState("idle");
      }
    };
    ws.onerror = () => { /* onclose will follow */ };
  }, [token, muted]);

  /* ---------- session control ---------- */
  const startSession = async () => {
    try {
      shouldReconnect.current = true;
      setError("");
      await initAudio();
      await ensureMic();
      await wireMicNode();
      connect();
    } catch (e) {
      setError(e?.message || "could not start");
      toast.error("Microphone denied or unavailable. Allow mic access.");
    }
  };

  const stopSession = () => {
    shouldReconnect.current = false;
    clearTimeout(reconnectTimer.current);
    try { wsRef.current?.close(); } catch {}
    try { playNodeRef.current?.port.postMessage({ type: "flush" }); } catch {}
    try { micStreamRef.current?.getTracks().forEach(t => t.stop()); } catch {}
    micStreamRef.current = null;
    try { sourceNodeRef.current?.disconnect(); } catch {}
    try { micNodeRef.current?.disconnect(); } catch {}
    setConnected(false); setListening(false); setSpeaking(false);
    setConnState("idle");
    setCaptions([]);
  };

  // PTT key handlers (Space) + click handlers
  useEffect(() => {
    const down = (e) => {
      if (mode !== "ptt") return;
      if (e.code === "Space" && !e.repeat && connected) {
        e.preventDefault(); ptt.current = true;
        wsSend({ type: "activity_start" });
      }
    };
    const up = (e) => {
      if (mode !== "ptt") return;
      if (e.code === "Space" && connected) {
        e.preventDefault(); ptt.current = false;
        wsSend({ type: "activity_end" });
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); };
  }, [mode, connected]);

  // device switching
  const switchDevice = async (id) => {
    setActiveDevice(id);
    if (!micStreamRef.current) return;
    await ensureMic(id);
    await wireMicNode();
  };

  // mute handling: when muted, stop forwarding mic but keep ws alive
  useEffect(() => {
    micNodeRef.current?.port.postMessage({ type: "mute", value: muted });
  }, [muted]);

  // cleanup on unmount
  useEffect(() => () => stopSession(), []); // eslint-disable-line

  // SSR autoplay guard
  const isSecure = typeof window !== "undefined" && window.isSecureContext;
  const hasMediaDevices = typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia;

  return (
    <AppShell>
      <PageHeader
        eyebrow="real-time voice · gemini live"
        title="Just talk."
        subtitle="Hands-free or push-to-talk. Interrupt anytime. Live captions."
        accent="#10b981"
        right={
          <div className="flex gap-2 items-center">
            <StatusPill ok={connected} label={
              connState === "live" ? `live · ${latencyMs ?? "—"}ms` :
              connState === "connecting" ? "connecting" :
              connState === "reconnecting" ? "reconnecting" :
              connState === "error" ? "error" : "idle"
            } icon={connected ? Wifi : WifiOff} />
            <button onClick={() => setMuted(m => !m)} className="px-3 py-2 rounded-full border border-white/10 hover:bg-white/5 flex items-center gap-2 text-xs">
              {muted ? <VolumeX size={12}/> : <Volume2 size={12}/>} {muted ? "muted" : "sound"}
            </button>
          </div>
        }
      />

      {!isSecure && (
        <div className="glass p-4 mb-4 text-sm text-amber-300 border border-amber-400/40">
          Voice requires HTTPS. This preview uses HTTPS — if you ever self-host on plain HTTP, mic access will be blocked.
        </div>
      )}
      {!hasMediaDevices && (
        <div className="glass p-4 mb-4 text-sm text-rose-300 border border-rose-400/40">
          This browser doesn't support the Web Audio APIs needed. Try Chrome, Edge, or Safari.
        </div>
      )}
      {error && (
        <div className="glass p-4 mb-4 text-sm text-red-300 border border-red-400/40 flex items-center gap-2">
          <AlertCircle size={14}/> {error}
        </div>
      )}

      {/* Mode + device row */}
      <div className="flex flex-wrap gap-2 mb-4">
        <div className="glass px-3 py-1.5 flex gap-1 items-center" style={{ borderRadius: 999 }}>
          <button onClick={() => setMode("handsfree")} data-testid="voice-mode-handsfree"
            className={`px-3 py-1 rounded-full text-xs flex items-center gap-1 transition ${mode === "handsfree" ? "bg-emerald-500/20 text-emerald-300" : "text-white/50 hover:text-white"}`}>
            <Radio size={11}/> hands-free
          </button>
          <button onClick={() => setMode("ptt")} data-testid="voice-mode-ptt"
            className={`px-3 py-1 rounded-full text-xs flex items-center gap-1 transition ${mode === "ptt" ? "bg-purple-500/20 text-purple-300" : "text-white/50 hover:text-white"}`}>
            <Hand size={11}/> push-to-talk (hold space)
          </button>
        </div>
        {devices.length > 1 && (
          <select value={activeDevice} onChange={(e) => switchDevice(e.target.value)} data-testid="voice-device"
            className="glass px-3 py-2 text-xs outline-none" style={{ borderRadius: 999 }}>
            {devices.map(d => <option key={d.deviceId} value={d.deviceId}>{d.label || "Microphone"}</option>)}
          </select>
        )}
        <div className="glass px-3 py-1.5 flex items-center gap-2 text-xs text-white/60" style={{ borderRadius: 999 }}>
          <Activity size={11} className="text-pink-400"/>
          <div className="w-24 h-1.5 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full" style={{ width: `${Math.min(100, level * 600)}%`, background: "linear-gradient(90deg,#ec4899,#a78bfa)" }} />
          </div>
          <span>mic</span>
        </div>
      </div>

      {/* Stage */}
      <div className="glass relative overflow-hidden flex flex-col" style={{ minHeight: "56vh" }} data-testid="voice-stage">
        <div className="flex-1 flex flex-col items-center justify-center gap-6 py-10">
          <motion.div
            animate={{
              scale: speaking ? [1, 1.08, 1] : 1 + Math.min(0.18, level * 4),
              boxShadow: speaking
                ? "0 0 160px 50px rgba(16,185,129,0.55)"
                : listening
                ? `0 0 ${80 + level * 800}px ${20 + level * 200}px rgba(236,72,153,${0.4 + level * 2})`
                : "0 0 60px 15px rgba(167,139,250,0.35)",
            }}
            transition={{ duration: speaking ? 0.9 : 0.06, ease: "easeInOut", repeat: speaking ? Infinity : 0 }}
            className="mind-orb"
            style={{ width: 240, height: 240 }}
          />
          <WaveformBars level={level} speaking={speaking} />
          <div className="text-[11px] uppercase tracking-[0.3em]" style={{ color: speaking ? "#10b981" : listening ? "#ec4899" : "#a78bfa" }}>
            {speaking ? "lyra speaking…" : listening ? (mode === "ptt" ? "hold SPACE to talk" : "listening") : connState === "reconnecting" ? "reconnecting…" : "ready"}
          </div>
          <div className="flex gap-3">
            {!connected ? (
              <button onClick={startSession} data-testid="voice-start"
                className="btn-pulse flex items-center gap-2 px-7 py-3.5 rounded-full bg-white text-black font-medium hover:scale-[1.03] transition">
                <Mic size={16}/> Begin conversation
              </button>
            ) : (
              <>
                {mode === "ptt" && (
                  <button
                    onMouseDown={() => { ptt.current = true; wsSend({ type: "activity_start" }); }}
                    onMouseUp={() => { ptt.current = false; wsSend({ type: "activity_end" }); }}
                    onMouseLeave={() => { if (ptt.current) { ptt.current = false; wsSend({ type: "activity_end" }); } }}
                    onTouchStart={(e) => { e.preventDefault(); ptt.current = true; wsSend({ type: "activity_start" }); }}
                    onTouchEnd={(e) => { e.preventDefault(); ptt.current = false; wsSend({ type: "activity_end" }); }}
                    data-testid="voice-ptt-button"
                    className={`select-none flex items-center gap-2 px-7 py-3.5 rounded-full font-medium transition ${ptt.current ? "bg-pink-500 text-white scale-105" : "bg-white text-black hover:scale-[1.03]"}`}>
                    {ptt.current ? <MicOff size={16}/> : <Mic size={16}/>} {ptt.current ? "talking…" : "hold to talk"}
                  </button>
                )}
                <button onClick={stopSession} data-testid="voice-stop"
                  className="flex items-center gap-2 px-6 py-3 rounded-full border border-white/15 hover:bg-white/5">
                  <Square size={14}/> end
                </button>
                <button onClick={() => { try { playNodeRef.current?.port.postMessage({ type: "flush" }); } catch{} setSpeaking(false); wsSend({ type: "activity_start" }); setTimeout(() => wsSend({ type: "activity_end" }), 50); }}
                  className="flex items-center gap-2 px-5 py-3 rounded-full border border-white/10 hover:bg-white/5 text-sm" title="Interrupt assistant">
                  <RotateCcw size={13}/> interrupt
                </button>
              </>
            )}
          </div>
          <div className="flex flex-wrap gap-2 justify-center text-[10px] text-white/40 max-w-xl text-center">
            try saying: {COMMANDS.map((c, i) => <span key={c} className="px-2 py-0.5 rounded-full bg-white/5">"{c}"</span>)}
          </div>
        </div>

        {/* live captions */}
        <div className="border-t border-white/5 px-5 py-4 max-h-56 overflow-y-auto bg-black/30" data-testid="voice-captions">
          <div className="text-xs uppercase tracking-widest text-white/40 mb-2">live captions</div>
          {captions.length === 0 ? (
            <div className="text-sm text-white/40">Captions appear as you and Lyra speak.</div>
          ) : (
            <AnimatePresence initial={false}>
              {captions.slice(-10).map((c, i) => (
                <motion.div key={`${c.t}-${i}`} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className={`text-sm mb-1 ${c.role === "user" ? "text-white" : "text-emerald-300"}`}>
                  <span className="text-[10px] uppercase tracking-widest mr-2 opacity-50">{c.role === "user" ? "you" : "lyra"}</span>{c.text}
                </motion.div>
              ))}
            </AnimatePresence>
          )}
        </div>
      </div>
    </AppShell>
  );
};

export default Voice;
