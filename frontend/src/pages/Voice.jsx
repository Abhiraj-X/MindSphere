import React, { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Mic, Square, Volume2, VolumeX, RefreshCcw } from "lucide-react";
import AppShell from "../components/AppShell";
import { PageHeader } from "../components/Shared";
import { http } from "../lib/api";
import { toast } from "sonner";

/**
 * Upgraded voice mode:
 * - Continuous listening (Web Speech API) with interim results
 * - VAD-ish: speech end auto-detected by recognition.onend
 * - Interruption: user starts speaking → cancel TTS instantly
 * - Best available browser voice picked (Google neural / Microsoft online)
 * - Audio analyser on synthesizer for animated orb pulse synced to amplitude
 * - Sentence-by-sentence TTS for natural pacing with micro-pauses
 */
const Voice = () => {
  const [active, setActive] = useState(false);            // overall session
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [interim, setInterim] = useState("");
  const [transcript, setTranscript] = useState([]);
  const [pulse, setPulse] = useState(1);                  // 1..1.4 for orb
  const recRef = useRef(null);
  const sessionId = useRef(`voice-${Date.now()}`);
  const audioCtxRef = useRef(null);
  const analyserRef = useRef(null);
  const animRef = useRef(null);
  const speakingRef = useRef(false);
  const restartGuardRef = useRef(false);

  // pick best voice once voices are available
  const pickVoice = () => {
    const all = window.speechSynthesis?.getVoices?.() || [];
    if (all.length === 0) return null;
    const prefs = [
      /google.*(uk|us).*(female|neural)/i,
      /microsoft.*(jenny|aria|libby|natural|online)/i,
      /samantha|victoria|karen|moira|tessa/i,
      /google.*english/i,
      /female/i,
    ];
    for (const re of prefs) {
      const v = all.find((x) => re.test(x.name));
      if (v) return v;
    }
    return all[0];
  };
  const voiceRef = useRef(null);
  useEffect(() => {
    const set = () => { voiceRef.current = pickVoice(); };
    set();
    window.speechSynthesis?.addEventListener?.("voiceschanged", set);
    return () => window.speechSynthesis?.removeEventListener?.("voiceschanged", set);
  }, []);

  // microphone amplitude → pulse (for orb when user speaks)
  const startMicAmplitude = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      audioCtxRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioCtxRef.current.createMediaStreamSource(stream);
      const an = audioCtxRef.current.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      analyserRef.current = an;
      const buf = new Uint8Array(an.frequencyBinCount);
      const tick = () => {
        if (!analyserRef.current) return;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        const rms = Math.sqrt(sum / buf.length);
        setPulse(1 + Math.min(0.5, rms * 4));
        animRef.current = requestAnimationFrame(tick);
      };
      tick();
      return stream;
    } catch (e) {
      toast.error("Microphone blocked. Allow mic access in your browser.");
      throw e;
    }
  };

  const stopMicAmplitude = () => {
    cancelAnimationFrame(animRef.current);
    try { audioCtxRef.current?.close(); } catch {}
    analyserRef.current = null;
    audioCtxRef.current = null;
  };

  // Speak with sentence chunking & prosody
  const speak = (text) =>
    new Promise((resolve) => {
      if (muted || !window.speechSynthesis) { resolve(); return; }
      window.speechSynthesis.cancel();
      const parts = text.split(/(?<=[.!?])\s+/).filter(Boolean);
      let i = 0;
      const next = () => {
        if (i >= parts.length) {
          setSpeaking(false); speakingRef.current = false; resolve(); return;
        }
        const u = new SpeechSynthesisUtterance(parts[i]);
        if (voiceRef.current) u.voice = voiceRef.current;
        // light prosody variation
        u.rate = 0.96 + Math.random() * 0.08;
        u.pitch = 1.02 + (Math.random() - 0.5) * 0.12;
        u.volume = 1;
        u.onstart = () => { setSpeaking(true); speakingRef.current = true; };
        u.onend = () => { i += 1; setTimeout(next, 80 + Math.random() * 80); };
        u.onerror = () => { i += 1; next(); };
        window.speechSynthesis.speak(u);
      };
      next();
    });

  const interruptSpeech = () => {
    if (speakingRef.current) {
      window.speechSynthesis?.cancel();
      setSpeaking(false); speakingRef.current = false;
    }
  };

  const setupRecognition = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return null;
    const r = new SR();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    r.onstart = () => setListening(true);
    let finalBuf = "";
    r.onresult = (e) => {
      let interimTxt = "", finalTxt = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript;
        if (e.results[i].isFinal) finalTxt += t + " ";
        else interimTxt += t;
      }
      setInterim(interimTxt);
      // user speaking → interrupt assistant
      if (interimTxt.trim().length > 1) interruptSpeech();
      if (finalTxt.trim()) {
        finalBuf += finalTxt;
        // debounce: process after short pause
        clearTimeout(r._procTimer);
        r._procTimer = setTimeout(() => {
          const msg = finalBuf.trim();
          finalBuf = "";
          setInterim("");
          handleUtterance(msg);
        }, 600);
      }
    };
    r.onend = () => {
      setListening(false);
      // graceful reconnect
      if (active && !restartGuardRef.current) {
        setTimeout(() => { try { r.start(); } catch {} }, 200);
      }
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed") { toast.error("Microphone permission denied."); stopSession(); }
    };
    return r;
  };

  const handleUtterance = async (msg) => {
    if (!msg) return;
    setTranscript((t) => [...t, { role: "user", text: msg }]);
    try {
      const { data } = await http.post("/chat", { message: msg, session_id: sessionId.current });
      setTranscript((t) => [...t, { role: "assistant", text: data.reply }]);
      await speak(data.reply);
    } catch {
      toast.error("Lyra couldn't respond.");
    }
  };

  const startSession = async () => {
    setActive(true);
    setTranscript([]);
    try {
      await startMicAmplitude();
    } catch { setActive(false); return; }
    // greeting
    try {
      const { data } = await http.get("/voice/opener");
      setTranscript([{ role: "assistant", text: data.text }]);
      await speak(data.text);
    } catch {}
    // start recognition
    const r = setupRecognition();
    if (!r) { toast.error("Voice not supported. Try desktop Chrome."); return; }
    recRef.current = r;
    try { r.start(); } catch {}
  };

  const stopSession = () => {
    restartGuardRef.current = true;
    setActive(false); setListening(false);
    try { recRef.current?.stop(); } catch {}
    interruptSpeech();
    stopMicAmplitude();
    setTimeout(() => { restartGuardRef.current = false; }, 800);
  };

  const SR = typeof window !== "undefined" && (window.SpeechRecognition || window.webkitSpeechRecognition);

  return (
    <AppShell>
      <PageHeader
        eyebrow="real-time voice"
        title="Just talk."
        subtitle="Continuous listening. Natural pauses. Interrupt anytime — Lyra will stop and listen."
        accent="#10b981"
        right={
          <div className="flex gap-2">
            <button onClick={() => setMuted((m) => !m)} className="px-4 py-2.5 rounded-full border border-white/10 hover:bg-white/5 flex items-center gap-2 text-sm">
              {muted ? <><VolumeX size={14}/> muted</> : <><Volume2 size={14}/> sound on</>}
            </button>
          </div>
        }
      />

      {!SR && (
        <div className="glass p-5 mb-5 text-sm text-amber-300 border border-amber-400/30">
          Real-time voice needs Chrome (desktop) or Edge. On other browsers, use the chat tab to message Lyra.
        </div>
      )}

      <div className="glass relative overflow-hidden" style={{ height: "62vh" }} data-testid="voice-stage">
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-7">
          <motion.div
            animate={{
              scale: speaking ? [1, 1.1 + (pulse - 1) * 0.5, 1] : pulse,
              boxShadow: speaking
                ? "0 0 140px 40px rgba(16,185,129,0.5)"
                : listening
                ? `0 0 ${60 + (pulse - 1) * 120}px ${15 + (pulse - 1) * 40}px rgba(236,72,153,0.45)`
                : "0 0 60px 15px rgba(167,139,250,0.4)",
            }}
            transition={{ duration: speaking ? 0.9 : 0.12, ease: "easeInOut", repeat: speaking ? Infinity : 0 }}
            className="mind-orb"
            style={{ width: 280, height: 280 }}
          />
          <div className="flex flex-col items-center gap-2">
            <div className="text-xs uppercase tracking-[0.3em]" style={{ color: speaking ? "#10b981" : listening ? "#ec4899" : "#a78bfa" }}>
              {speaking ? "lyra speaking…" : listening ? "listening" : active ? "thinking…" : "ready"}
            </div>
            {interim && <div className="text-sm text-white/60 max-w-md text-center italic">"{interim}"</div>}
          </div>
          <div className="flex gap-3">
            {!active ? (
              <button onClick={startSession} data-testid="voice-start"
                className="btn-pulse flex items-center gap-2 px-7 py-3.5 rounded-full bg-white text-black font-medium hover:scale-[1.03] transition">
                <Mic size={16}/> Begin conversation
              </button>
            ) : (
              <>
                <button onClick={stopSession} data-testid="voice-stop"
                  className="flex items-center gap-2 px-6 py-3 rounded-full border border-white/15 hover:bg-white/5">
                  <Square size={14}/> end
                </button>
                <button onClick={() => { interruptSpeech(); setTranscript([]); sessionId.current = `voice-${Date.now()}`; }}
                  className="flex items-center gap-2 px-5 py-3 rounded-full border border-white/10 hover:bg-white/5 text-sm">
                  <RefreshCcw size={13}/> reset
                </button>
              </>
            )}
          </div>
          <div className="text-[11px] text-white/40 max-w-md text-center px-6">
            Tip: speak naturally. Interrupt Lyra anytime — when you start talking, she stops.
          </div>
        </div>
      </div>

      <div className="glass mt-5 p-5 max-h-72 overflow-y-auto" data-testid="voice-transcript">
        <div className="text-xs uppercase tracking-widest text-white/40 mb-3">live transcript</div>
        {transcript.length === 0 && <div className="text-sm text-white/40">Press begin to start your conversation.</div>}
        {transcript.map((t, i) => (
          <div key={i} className={`text-sm mb-2 ${t.role === "user" ? "text-white" : "text-emerald-300"}`}>
            <span className="text-[10px] uppercase tracking-widest mr-2 opacity-50">{t.role === "user" ? "you" : "lyra"}</span>{t.text}
          </div>
        ))}
      </div>
    </AppShell>
  );
};

export default Voice;
