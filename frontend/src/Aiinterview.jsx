/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef, useCallback } from "react";

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const BACKEND_URL     = "http://localhost:8000";
const TOTAL_QUESTIONS = 6;
const SILENCE_MS      = 4500;
const MAX_WARNINGS    = 5;

const JOB_ROLES = [
  { id: "frontend",  label: "Frontend Developer" },
  { id: "backend",   label: "Backend Developer" },
  { id: "fullstack", label: "Full Stack Developer" },
  { id: "data",      label: "Data Analyst" },
  { id: "devops",    label: "DevOps Engineer" },
  { id: "ml",        label: "ML Engineer" },
  { id: "pm",        label: "Product Manager" },
];

const EXP_LEVELS = [
  { id: "fresher", label: "Fresher",   desc: "0 – 1 yr" },
  { id: "mid",     label: "Mid-level", desc: "2 – 4 yrs" },
  { id: "senior",  label: "Senior",    desc: "5 + yrs" },
];

// ─────────────────────────────────────────────────────────────────────────────
// SESSION FACTORY
// ─────────────────────────────────────────────────────────────────────────────
function makeSession() {
  return {
    candidate:     { name: "", role: "", experience: "" },
    questionCount: 0,
    questions:     [],        // { text, topic, answer, aiScore, aiFeedback, isFollowUp }
    violations:    [],        // { type, time }
    coveredTopics: [],
    followOnUsed:  false,
    phase:         "setup",   // setup | proctor | interview | complete
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// MEDIAPIPE LOADER
// ─────────────────────────────────────────────────────────────────────────────
function loadMediaPipe() {
  return new Promise((resolve, reject) => {
    if (window._mpReady) { resolve(); return; }
    const s1 = document.createElement("script");
    s1.src = "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js";
    s1.crossOrigin = "anonymous";
    s1.onload = () => {
      const s2 = document.createElement("script");
      s2.src = "https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js";
      s2.crossOrigin = "anonymous";
      s2.onload  = () => { window._mpReady = true; resolve(); };
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    s1.onerror = reject;
    document.head.appendChild(s1);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCTOR HOOK  (maxNumFaces: 2 to detect multiple faces)
// ─────────────────────────────────────────────────────────────────────────────
function useProctor(active) {
  const videoRef   = useRef(null);
  const mpCamRef   = useRef(null);
  const mountedRef = useRef(false);
  const [status,    setStatus]    = useState("noface"); // noface | lookdown | ok | multiface
  const [ready,     setReady]     = useState(false);
  const [error,     setError]     = useState("");
  const [faceCount, setFaceCount] = useState(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      try { mpCamRef.current?.stop(); } catch {}
    };
  }, []);

  useEffect(() => {
    if (!active) {
      try { mpCamRef.current?.stop(); } catch {}
      mpCamRef.current = null;
      setReady(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        await loadMediaPipe();
        if (cancelled) return;

        const fm = new window.FaceMesh({
          locateFile: f => "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/" + f,
        });
        fm.setOptions({
          maxNumFaces: 2,
          refineLandmarks: false,
          minDetectionConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });
        fm.onResults(results => {
          if (!mountedRef.current) return;
          const count = results.multiFaceLandmarks?.length || 0;
          setFaceCount(count);
          if (count > 1) { setStatus("multiface"); return; }
          let next = "noface";
          if (count === 1) {
            const lm   = results.multiFaceLandmarks[0];
            const fh   = lm[10], nose = lm[1], chin = lm[152], le = lm[159], re = lm[386];
            const faceH = chin.y - fh.y;
            const ratio = faceH > 0 ? (nose.y - fh.y) / faceH : 0;
            const eyeRel = faceH > 0 ? ((le.y + re.y) / 2 - fh.y) / faceH : 1;
            const ok =
              faceH > 0.15 &&
              fh.y   > 0.05 &&
              chin.y < 0.92 &&
              ratio  > 0.42 &&
              eyeRel > 0.25 && eyeRel < 0.62;
            next = ok ? "ok" : faceH > 0.05 ? "lookdown" : "noface";
          }
          setStatus(next);
        });

        const cam = new window.Camera(videoRef.current, {
          onFrame: async () => { if (videoRef.current) await fm.send({ image: videoRef.current }); },
          width: 640, height: 480,
        });
        mpCamRef.current = cam;
        await cam.start();
        if (mountedRef.current) setReady(true);
      } catch { if (mountedRef.current) setError("Camera unavailable"); }
    })();
    return () => {
      cancelled = true;
      try { mpCamRef.current?.stop(); } catch {}
      mpCamRef.current = null;
    };
  }, [active]);

  return { videoRef, status, ready, error, faceCount };
}

// ─────────────────────────────────────────────────────────────────────────────
// TOAST SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
function useToast() {
  const [toasts, setToasts] = useState([]);
  const add = useCallback((msg, type = "warn") => {
    const id = Date.now() + Math.random();
    setToasts(p => [...p, { id, msg, type }]);
    setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 4500);
  }, []);
  return { toasts, add };
}

function ToastContainer({ toasts }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position:"fixed", top:64, right:20, zIndex:9999, display:"flex", flexDirection:"column", gap:8, pointerEvents:"none" }}>
      {toasts.map(t => (
        <div key={t.id} style={{
          background: t.type==="error" ? "#ef4444" : t.type==="success" ? "#22c55e" : "#f59e0b",
          color: "#000", fontWeight: 700, fontSize: 13,
          padding: "10px 18px", borderRadius: 10,
          boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", gap: 8,
          animation: "toastIn 0.3s ease",
        }}>
          <span style={{ fontSize: 16 }}>
            {t.type==="error" ? "🚨" : t.type==="success" ? "✓" : "⚠️"}
          </span>
          {t.msg}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCTOR OVERLAY  (used during interview phase)
// ─────────────────────────────────────────────────────────────────────────────
function ProctorOverlay({ active, onTerminate, addViolation, warnCount, setWarnCount }) {
  const { videoRef, status, ready, error, faceCount } = useProctor(active);
  const [collapsed,    setCollapsed]    = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [alertMsg,     setAlertMsg]     = useState("");
  const alertTimerRef      = useRef(null);
  const multiFaceDebounce  = useRef(null);
  const prevStatus         = useRef("noface");

  useEffect(() => {
    const isViol  = status === "lookdown" || status === "multiface";
    const wasViol = prevStatus.current === "lookdown" || prevStatus.current === "multiface";

    if (isViol && !wasViol) {
      if (status === "multiface") {
        // Debounce: only count once per 5 s of continuous multi-face
        if (!multiFaceDebounce.current) {
          multiFaceDebounce.current = setTimeout(() => { multiFaceDebounce.current = null; }, 5000);
          const msg = `Multiple faces detected (${faceCount})! Only you should be visible.`;
          setAlertMsg(msg);
          addViolation("multiple_faces");
          setWarnCount(prev => {
            const next = prev + 1;
            if (next >= MAX_WARNINGS) setTimeout(() => onTerminate?.(), 1800);
            return next;
          });
          fireAlert(msg);
        }
      } else {
        const msg = "Please look straight at the screen to continue your interview.";
        setAlertMsg(msg);
        addViolation("look_away");
        setWarnCount(prev => {
          const next = prev + 1;
          if (next >= MAX_WARNINGS) setTimeout(() => onTerminate?.(), 1800);
          return next;
        });
        fireAlert(msg);
      }
    }
    if (status === "ok") { clearTimeout(alertTimerRef.current); setAlertVisible(false); }
    prevStatus.current = status;
  }, [status]);

  const fireAlert = (msg) => {
    setAlertMsg(msg);
    setAlertVisible(true);
    clearTimeout(alertTimerRef.current);
    alertTimerRef.current = setTimeout(() => setAlertVisible(false), 4000);
  };

  useEffect(() => () => {
    clearTimeout(alertTimerRef.current);
    clearTimeout(multiFaceDebounce.current);
  }, []);

  if (!active) return null;

  const remaining = MAX_WARNINGS - warnCount;
  const dotColor =
    !ready              ? "#475569" :
    status === "ok"      ? "#22c55e" :
    status === "multiface"? "#ef4444" :
    status === "lookdown" ? "#f59e0b" : "#ef4444";

  const dotLabel =
    !ready               ? "Loading…"               :
    error                ? "Camera error"           :
    status === "ok"       ? "Looking straight"       :
    status === "multiface"? `${faceCount} faces!`    :
    status === "lookdown" ? "Look at screen"         : "No face";

  return (
    <>
      {/* ── Top banner ── */}
      <div style={{ position:"fixed", top:0, left:0, right:0, zIndex:2001, display:"flex", justifyContent:"center", pointerEvents:"none" }}>
        <div style={{
          background: warnCount >= MAX_WARNINGS ? "#ef4444" : status==="multiface" ? "#ef4444" : "#f59e0b",
          color: "#000", fontWeight: 700, fontSize: 13,
          padding: "9px 24px", borderRadius: "0 0 12px 12px",
          boxShadow: "0 4px 24px rgba(245,158,11,0.4)",
          display: "flex", alignItems: "center", gap: 8,
          transform: alertVisible ? "translateY(0)" : "translateY(-110%)",
          transition: "transform 0.35s cubic-bezier(.22,1,.36,1)",
          maxWidth: 520, textAlign: "center",
        }}>
          ⚠️ {warnCount >= MAX_WARNINGS
            ? "Too many violations — terminating…"
            : `${alertMsg} (Warning ${warnCount}/${MAX_WARNINGS})`}
        </div>
      </div>

      {/* ── Camera widget ── */}
      <div style={{ position:"fixed", bottom:20, right:20, zIndex:2000, display:"flex", flexDirection:"column", alignItems:"flex-end", gap:6 }}>
        {collapsed ? (
          <button onClick={() => setCollapsed(false)} style={{ display:"flex", alignItems:"center", gap:7, background:"#090f1e", border:`1.5px solid ${dotColor}44`, borderRadius:20, padding:"6px 12px 6px 9px", cursor:"pointer", color:"#e2e8f0", fontSize:12, fontWeight:700, boxShadow:"0 4px 18px rgba(0,0,0,0.5)" }}>
            <span style={{ width:8, height:8, borderRadius:"50%", background:dotColor, boxShadow:`0 0 6px ${dotColor}` }} />
            Proctor
            {warnCount > 0 && <span style={{ marginLeft:3, background:remaining<=1?"#ef4444":"#f59e0b", color:"#000", borderRadius:8, fontSize:10, fontWeight:800, padding:"1px 6px" }}>{warnCount}/{MAX_WARNINGS}</span>}
          </button>
        ) : (
          <div style={{ background:"#090f1e", borderRadius:14, overflow:"hidden", width:190, border:`1.5px solid ${status==="multiface"?"#ef444455":status==="lookdown"?"#f59e0b55":status==="ok"?"#22c55e33":"#1a2540"}`, boxShadow:"0 8px 32px rgba(0,0,0,0.6)", transition:"border-color 0.3s" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"6px 10px", borderBottom:"1px solid #0c1526", background:"#060c18" }}>
              <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                <span style={{ width:7, height:7, borderRadius:"50%", background:dotColor, boxShadow:`0 0 5px ${dotColor}` }} />
                <span style={{ fontSize:11, fontWeight:700, color:"#64748b" }}>Proctor</span>
                {warnCount > 0 && <span style={{ fontSize:10, fontWeight:800, padding:"1px 5px", borderRadius:6, background:remaining<=1?"#ef444422":"#f59e0b22", color:remaining<=1?"#ef4444":"#f59e0b", border:`1px solid ${remaining<=1?"#ef444440":"#f59e0b40"}` }}>{warnCount}/{MAX_WARNINGS}</span>}
              </div>
              <button onClick={() => setCollapsed(true)} style={{ background:"none", border:"none", color:"#2a3a5c", cursor:"pointer", fontSize:13, lineHeight:1, padding:"0 2px" }}>—</button>
            </div>
            <div style={{ position:"relative", width:190, height:140, background:"#060c18" }}>
              <video ref={videoRef} autoPlay muted playsInline style={{ width:"100%", height:"100%", objectFit:"cover", transform:"scaleX(-1)", display:"block", opacity:ready?1:0, transition:"opacity 0.5s" }} />
              {ready && status !== "ok" && <div style={{ position:"absolute", inset:0, background:status==="multiface"?"rgba(239,68,68,0.2)":status==="lookdown"?"rgba(245,158,11,0.12)":"rgba(5,10,20,0.4)", transition:"background 0.3s" }} />}
              {ready && status === "multiface" && (
                <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}>
                  <span style={{ fontSize:11, fontWeight:700, color:"#ef4444", background:"rgba(0,0,0,0.75)", padding:"3px 7px", borderRadius:5 }}>⚠ {faceCount} faces</span>
                </div>
              )}
              {!ready && !error && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ fontSize:11, color:"#2a3a5c" }}>Starting…</span></div>}
              {error && <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center" }}><span style={{ fontSize:11, color:"#ef444488" }}>Unavailable</span></div>}
            </div>
            <div style={{ padding:"5px 10px", display:"flex", alignItems:"center", justifyContent:"space-between", background:(status==="lookdown"||status==="multiface")?"rgba(245,158,11,0.07)":"transparent" }}>
              <span style={{ fontSize:11, fontWeight:600, color:dotColor }}>{(status==="lookdown"||status==="multiface")?"⚠ ":""}{dotLabel}</span>
              {warnCount > 0 && remaining > 0 && <span style={{ fontSize:10, color:remaining<=2?"#ef4444":"#64748b" }}>{remaining} left</span>}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// WAVEFORM
// ─────────────────────────────────────────────────────────────────────────────
function Waveform({ active, color = "#6366f1", bars = 18 }) {
  const [h, setH] = useState(Array(bars).fill(4));
  useEffect(() => {
    if (!active) { setH(Array(bars).fill(4)); return; }
    const iv = setInterval(() => setH(Array(bars).fill(0).map(() => 4 + Math.random() * 24)), 80);
    return () => clearInterval(iv);
  }, [active, bars]);
  return (
    <div style={{ display:"flex", alignItems:"center", gap:2, height:32 }}>
      {h.map((v, i) => (
        <div key={i} style={{ width:3, borderRadius:2, background:color, height:v, transition:"height 0.08s ease", opacity:active?0.6+(i%3)*0.13:0.1 }} />
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
export default function AIInterview() {
  const [session,        setSession]      = useState(makeSession());
  const [question,       setQuestion]     = useState(null);
  const [answer,         setAnswer]       = useState("");
  const [liveTranscript, setLive]         = useState("");
  const [evaluation,     setEval]         = useState(null);
  const [loading,        setLoading]      = useState(false);
  const [aiSpeaking,     setAiSpeak]      = useState(false);
  const [micOn,          setMicOn]        = useState(false);
  const [userTalking,    setTalking]      = useState(false);
  const [silenceSec,     setSilSec]       = useState(null);
  const [qSlot,          setQSlot]        = useState(1);
  const [sttConf,        setSttConf]      = useState(null);
  const [warnCount,      setWarnCount]    = useState(0); // shared violation count

  const { toasts, add: addToast } = useToast();

  // Refs so callbacks always see fresh values
  const recognitionRef = useRef(null);
  const silTimerRef    = useRef(null);
  const silCountRef    = useRef(null);
  const ansRef         = useRef("");
  const liveRef        = useRef("");
  const submittingRef  = useRef(false);
  const micActiveRef   = useRef(false);
  const doSubmitRef    = useRef(null);
  const advanceRef     = useRef(null);
  const sessionRef     = useRef(session);
  const questionRef    = useRef(question);

  ansRef.current      = answer;
  liveRef.current     = liveTranscript;
  sessionRef.current  = session;
  questionRef.current = question;

  // ── addViolation — writes to session AND shows toast ────────────────────
  const addViolation = useCallback((type) => {
    const entry = { type, time: Date.now() };
    setSession(s => ({ ...s, violations: [...s.violations, entry] }));
    const MSGS = {
      look_away:       "⚠️ Look at the screen!",
      multiple_faces:  "⚠️ Multiple faces detected!",
      keyboard_cheat:  "⚠️ Keyboard shortcut blocked!",
      tab_switch:      "⚠️ Tab switch detected!",
    };
    addToast(MSGS[type] || "⚠️ Violation detected", "warn");
  }, [addToast]);

  const violationCount = session.violations.length;

  // ── Anti-cheat listeners (active only during interview) ─────────────────
  useEffect(() => {
    if (session.phase !== "interview") return;

    const onKey = (e) => {
      const ctrl = e.ctrlKey || e.metaKey;
      const blocked =
        (ctrl && ["c","v","a"].includes(e.key.toLowerCase())) ||
        (ctrl && e.key === "Tab") ||
        (e.altKey && e.key === "Tab");
      if (blocked) {
        e.preventDefault();
        addViolation("keyboard_cheat");
      }
    };
    const onContext = (e) => { e.preventDefault(); addViolation("keyboard_cheat"); };
    const onBlur    = () => addViolation("tab_switch");

    document.addEventListener("keydown", onKey, true);
    document.addEventListener("contextmenu", onContext, true);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      document.removeEventListener("contextmenu", onContext, true);
      window.removeEventListener("blur", onBlur);
    };
  }, [session.phase, addViolation]);

  // ── Proctor terminate ───────────────────────────────────────────────────
  const handleProctorTerminate = useCallback(() => {
    window.speechSynthesis?.cancel();
    micActiveRef.current = false;
    setMicOn(false); setTalking(false); setLive("");
    try { recognitionRef.current?.stop(); recognitionRef.current = null; } catch {}
    setSession(s => ({ ...s, phase: "complete" }));
  }, []);

  // ── TTS ─────────────────────────────────────────────────────────────────
  const speak = useCallback((text, onDone) => {
    if (!window.speechSynthesis) { onDone?.(); return; }
    window.speechSynthesis.cancel();
    setAiSpeak(true);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.0; u.pitch = 1.0; u.volume = 1;
    const pickVoice = () => {
      const vs = window.speechSynthesis.getVoices();
      const v = vs.find(x =>
        x.name === "Google UK English Female" ||
        x.name === "Google US English" ||
        x.name.includes("Samantha") ||
        x.name.includes("Karen"))
        || vs.find(x => x.lang.startsWith("en") && !x.localService)
        || vs[0];
      if (v) u.voice = v;
    };
    if (window.speechSynthesis.getVoices().length) pickVoice();
    else window.speechSynthesis.onvoiceschanged = pickVoice;
    u.onend   = () => { setAiSpeak(false); onDone?.(); };
    u.onerror = () => { setAiSpeak(false); onDone?.(); };
    window.speechSynthesis.speak(u);
  }, []);

  // ── Silence / mic helpers ───────────────────────────────────────────────
  const clearSilence = useCallback(() => {
    clearTimeout(silTimerRef.current);
    clearInterval(silCountRef.current);
    setSilSec(null);
  }, []);

  const hardStopMic = useCallback(() => {
    clearSilence();
    micActiveRef.current = false;
    setMicOn(false); setTalking(false); setLive("");
    try { recognitionRef.current?.stop(); recognitionRef.current = null; } catch {}
  }, [clearSilence]);

  const armSilence = useCallback(() => {
    clearSilence();
    silTimerRef.current = setTimeout(() => {
      let c = 4; setSilSec(c);
      silCountRef.current = setInterval(() => {
        c--; setSilSec(c);
        if (c <= 0) {
          clearInterval(silCountRef.current); setSilSec(null);
          const combined = (ansRef.current + " " + liveRef.current).trim();
          if (combined && !submittingRef.current) {
            hardStopMic();
            doSubmitRef.current?.(combined);
          }
        }
      }, 1000);
    }, SILENCE_MS);
  }, [clearSilence, hardStopMic]);

  // ── Improved STT ────────────────────────────────────────────────────────
  const startMic = useCallback(() => {
    if (micActiveRef.current || submittingRef.current) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { addToast("Speech recognition needs Chrome.", "error"); return; }

    setAnswer(""); setLive(""); setSttConf(null);
    let finalBuffer = "";

    const makeRec = () => {
      const r = new SR();
      r.lang = "en-US"; r.continuous = true;
      r.interimResults = true; r.maxAlternatives = 3;
      return r;
    };

    const attachHandlers = (rec) => {
      rec.onstart = () => { setMicOn(true); micActiveRef.current = true; armSilence(); };
      rec.onresult = (event) => {
        let interim = "";
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const res = event.results[i];
          if (res.isFinal) {
            let best = res[0];
            for (let j = 1; j < res.length; j++)
              if (res[j].confidence > best.confidence) best = res[j];
            const t = best.transcript.trim();
            if (t) {
              finalBuffer = (finalBuffer + " " + t).trim();
              setAnswer(finalBuffer);
              setSttConf(Math.round((best.confidence || 0.9) * 100));
              setLive("");
              armSilence();
            }
          } else {
            let best = res[0];
            for (let j = 1; j < res.length; j++)
              if ((res[j].confidence || 0) > (best.confidence || 0)) best = res[j];
            interim += best.transcript;
          }
        }
        if (interim) { setLive(interim); setTalking(true); armSilence(); setTimeout(() => setTalking(false), 600); }
      };
      rec.onerror = (e) => { if (e.error !== "no-speech") hardStopMic(); else armSilence(); };
      rec.onend = () => {
        if (micActiveRef.current && !submittingRef.current) {
          try { const nr = makeRec(); attachHandlers(nr); recognitionRef.current = nr; nr.start(); } catch {}
        } else { setMicOn(false); micActiveRef.current = false; setTalking(false); setLive(""); }
      };
    };

    const first = makeRec();
    attachHandlers(first);
    recognitionRef.current = first;
    try { first.start(); } catch { addToast("Could not start mic.", "error"); }
  }, [armSilence, hardStopMic, addToast]);

  const toggleMic = useCallback(() => { if (micOn) hardStopMic(); else startMic(); }, [micOn, hardStopMic, startMic]);
  useEffect(() => () => { hardStopMic(); window.speechSynthesis?.cancel(); }, [hardStopMic]);

  // ── API helper ──────────────────────────────────────────────────────────
  const api = async (ep, body) => {
    const r = await fetch(`${BACKEND_URL}${ep}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  };

  // ── Generate question ───────────────────────────────────────────────────
  const generateQuestion = useCallback(async (followUpText = null, currentSlot = 1) => {
    if (currentSlot > TOTAL_QUESTIONS) {
      setSession(s => ({ ...s, phase: "complete" }));
      return;
    }
    const sess = sessionRef.current;
    setLoading(true); setEval(null); setAnswer(""); setLive(""); setSttConf(null);
    submittingRef.current = false;
    hardStopMic();
    window.speechSynthesis?.cancel();

    if (followUpText) {
      const q = { question: followUpText, topic: "Follow-up", key_concepts: [] };
      setQuestion(q);
      setSession(s => ({ ...s, questionCount: s.questionCount + 1 }));
      setLoading(false);
      speak(followUpText, () => startMic());
      return;
    }

    try {
      const roleLabel = JOB_ROLES.find(r => r.id === sess.candidate.role)?.label || sess.candidate.role;
      const expLabel  = EXP_LEVELS.find(e => e.id === sess.candidate.experience)?.label || sess.candidate.experience;

      const data = await api("/generate-question", {
        domain:            sess.candidate.role,
        difficulty:        sess.candidate.experience,
        previous_questions: sess.questions.map(q => q.text),
        covered_topics:    sess.coveredTopics,
        candidate_name:    sess.candidate.name,
        job_role:          roleLabel,
        experience_level:  expLabel,
      });

      setQuestion(data);
      if (data.topic) {
        setSession(s => ({
          ...s,
          coveredTopics: [...s.coveredTopics, data.topic],
          questionCount: s.questionCount + 1,
        }));
      }
      setLoading(false);
      speak(data.question, () => startMic());
    } catch {
      setLoading(false);
      addToast("Backend error — is the server running on :8000?", "error");
    }
  }, [speak, startMic, hardStopMic, addToast]);

  // ── Smart sufficiency check ─────────────────────────────────────────────
  const checkSufficiency = useCallback(async (q, a) => {
    try {
      const data = await api("/check-sufficiency", { question: q, answer: a });
      return data.sufficient === true;
    } catch { return true; } // default: treat as sufficient on error
  }, []);

  // ── Submit answer ───────────────────────────────────────────────────────
  const doSubmit = useCallback(async (finalAnswer) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    hardStopMic();
    setLoading(true);

    try {
      const sess      = sessionRef.current;
      const isFollowUp = questionRef.current?.topic === "Follow-up";
      const roleLabel  = JOB_ROLES.find(r => r.id === sess.candidate.role)?.label || sess.candidate.role;
      const expLabel   = EXP_LEVELS.find(e => e.id === sess.candidate.experience)?.label || sess.candidate.experience;

      const data = await api("/evaluate-answer", {
        question:         questionRef.current?.question,
        answer:           finalAnswer,
        domain:           sess.candidate.role,
        job_role:         roleLabel,
        experience_level: expLabel,
        difficulty:       sess.candidate.experience,
        attempt_number:   1,
        is_follow_up:     isFollowUp,
      });

      setSession(s => ({
        ...s,
        questions: [...s.questions, {
          text:       questionRef.current?.question,
          topic:      questionRef.current?.topic,
          answer:     finalAnswer,
          aiScore:    data.score,
          aiFeedback: data.feedback,
          isFollowUp,
        }],
      }));

      setEval(data);
      setLoading(false);
      speak(data.feedback, () => setTimeout(() => advanceRef.current?.(data), 1500));
    } catch {
      addToast("Evaluation error — try again.", "error");
      submittingRef.current = false;
      setLoading(false);
    }
  }, [speak, hardStopMic, addToast]);

  doSubmitRef.current = doSubmit;

  const manualSubmit = () => {
    const a = (ansRef.current + " " + liveRef.current).trim();
    if (!a) { addToast("Say or type something first.", "warn"); return; }
    clearSilence(); hardStopMic(); doSubmit(a);
  };

  // ── Advance ─────────────────────────────────────────────────────────────
  const advance = useCallback(async (evalData) => {
    setEval(null);
    submittingRef.current = false;

    setQSlot(prev => {
      const nextSlot = prev + 1;
      if (nextSlot > TOTAL_QUESTIONS) {
        setSession(s => ({ ...s, phase: "complete" }));
        return prev;
      }

      const isCurrentFollowUp = questionRef.current?.topic === "Follow-up";
      const sess              = sessionRef.current;

      const mightFollowUp =
        !isCurrentFollowUp &&
        !sess.followOnUsed &&
        (evalData.next_action === "clarify" || evalData.next_action === "simplify") &&
        evalData.follow_up_question;

      if (mightFollowUp) {
        // Smart check: only follow-up if answer was actually insufficient
        (async () => {
          const sufficient = await checkSufficiency(
            questionRef.current?.question,
            ansRef.current
          );
          if (!sufficient) {
            setSession(s => ({ ...s, followOnUsed: true }));
            generateQuestion(evalData.follow_up_question, nextSlot);
          } else {
            setSession(s => ({ ...s, followOnUsed: false }));
            generateQuestion(null, nextSlot);
          }
        })();
      } else {
        setSession(s => ({ ...s, followOnUsed: false }));
        generateQuestion(null, nextSlot);
      }
      return nextSlot;
    });
  }, [generateQuestion, checkSufficiency]);

  advanceRef.current = advance;
  const manualNext = () => evaluation && advance(evaluation);

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: SETUP SCREEN
  // ─────────────────────────────────────────────────────────────────────────
  if (session.phase === "setup") {
    const c = session.candidate;
    const canContinue = c.name.trim() && c.role && c.experience;
    const setC = (key, val) => setSession(s => ({ ...s, candidate: { ...s.candidate, [key]: val } }));

    return (
      <div style={{ minHeight:"100vh", background:"#050a14", display:"flex", alignItems:"center", justifyContent:"center", padding:"32px 20px", fontFamily:"system-ui,-apple-system,sans-serif" }}>
        <style>{CSS}</style>
        <ToastContainer toasts={toasts} />
        <div style={{ width:"100%", maxWidth:540, background:"#090f1e", border:"1px solid #1a2540", borderRadius:24, padding:"44px 48px", boxShadow:"0 30px 80px rgba(0,0,0,0.6)" }}>
          {/* Logo */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:32 }}>
            <div style={{ width:9, height:9, borderRadius:"50%", background:"#6366f1", boxShadow:"0 0 10px #6366f1" }} />
            <span style={{ fontSize:14, fontWeight:700, color:"#64748b", letterSpacing:0.5 }}>InterviewAI</span>
          </div>

          <h1 style={{ fontSize:26, fontWeight:800, color:"#e2e8f0", marginBottom:6, lineHeight:1.2 }}>Pre-Interview Setup</h1>
          <p style={{ color:"#475569", fontSize:14, marginBottom:32, lineHeight:1.65 }}>
            Tell us about you so we can personalise the questions to your role and level.
          </p>

          {/* Name */}
          <label style={LS.label}>Full Name</label>
          <input
            style={LS.input}
            placeholder="e.g. Priya Sharma"
            value={c.name}
            onChange={e => setC("name", e.target.value)}
            onKeyDown={e => e.key === "Enter" && canContinue && setSession(s => ({...s, phase:"proctor"}))}
          />

          {/* Role */}
          <label style={LS.label}>Job Role Applying For</label>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8, marginBottom:24 }}>
            {JOB_ROLES.map(r => (
              <div key={r.id} onClick={() => setC("role", r.id)} style={{
                padding:"10px 14px", borderRadius:10, cursor:"pointer",
                border:`1.5px solid ${c.role===r.id?"#6366f1":"#1a2540"}`,
                background: c.role===r.id ? "#6366f115" : "transparent",
                fontSize:13, fontWeight:600,
                color: c.role===r.id ? "#a5b4fc" : "#475569",
                transition:"all 0.15s",
              }}>{r.label}</div>
            ))}
          </div>

          {/* Experience */}
          <label style={LS.label}>Experience Level</label>
          <div style={{ display:"flex", gap:8, marginBottom:36 }}>
            {EXP_LEVELS.map(e => (
              <div key={e.id} onClick={() => setC("experience", e.id)} style={{
                flex:1, padding:"12px 0", borderRadius:10, cursor:"pointer", textAlign:"center",
                border:`1.5px solid ${c.experience===e.id?"#6366f1":"#1a2540"}`,
                background: c.experience===e.id ? "#6366f115" : "transparent",
                transition:"all 0.15s",
              }}>
                <div style={{ fontSize:13, fontWeight:700, color:c.experience===e.id?"#a5b4fc":"#475569" }}>{e.label}</div>
                <div style={{ fontSize:11, color:"#2a3a5c", marginTop:2 }}>{e.desc}</div>
              </div>
            ))}
          </div>

          <button
            disabled={!canContinue}
            onClick={() => setSession(s => ({ ...s, phase: "proctor" }))}
            style={{
              width:"100%", padding:"14px", borderRadius:12, border:"none",
              background: canContinue ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "#1a2540",
              color: canContinue ? "#fff" : "#2a3a5c",
              fontSize:15, fontWeight:700,
              cursor: canContinue ? "pointer" : "not-allowed",
              boxShadow: canContinue ? "0 4px 22px rgba(99,102,241,0.38)" : "none",
              transition:"all 0.2s",
            }}>
            Continue to Camera Check →
          </button>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: PROCTOR GATE
  // ─────────────────────────────────────────────────────────────────────────
  if (session.phase === "proctor") {
    return (
      <ProctorGate
        candidate={session.candidate}
        addViolation={addViolation}
        onComplete={() => {
          setSession(s => ({ ...s, phase: "interview" }));
          // Fullscreen
          const el = document.documentElement;
          if (el.requestFullscreen) el.requestFullscreen();
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
          generateQuestion(null, 1);
        }}
      />
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: RESULTS
  // ─────────────────────────────────────────────────────────────────────────
  if (session.phase === "complete") {
    const qs        = session.questions;
    const avgScore  = qs.length ? Math.round(qs.reduce((s,q)=>s+q.aiScore,0)/qs.length*10)/10 : 0;
    const grade     = avgScore>=8?"Excellent":avgScore>=6?"Good":avgScore>=4?"Fair":"Needs Practice";
    const gc        = avgScore>=8?"#22c55e":avgScore>=6?"#6366f1":avgScore>=4?"#f59e0b":"#ef4444";
    const terminated= violationCount >= MAX_WARNINGS && qs.length < TOTAL_QUESTIONS;
    const roleName  = JOB_ROLES.find(r=>r.id===session.candidate.role)?.label || "";
    const expName   = EXP_LEVELS.find(e=>e.id===session.candidate.experience)?.label || "";

    const doReset = () => {
      setSession(makeSession());
      setQSlot(1); setQuestion(null); setEval(null);
      setAnswer(""); setLive(""); setWarnCount(0);
    };

    return (
      <div style={{ minHeight:"100vh", background:"#050a14", color:"#e2e8f0", fontFamily:"system-ui,-apple-system,sans-serif", padding:"48px 20px" }}>
        <style>{CSS}</style>
        <ToastContainer toasts={toasts} />
        <div style={{ maxWidth:680, margin:"0 auto" }}>
          {/* Logo */}
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:32 }}>
            <div style={{ width:8, height:8, borderRadius:"50%", background:"#6366f1" }} />
            <span style={{ fontSize:14, fontWeight:700, color:"#64748b" }}>InterviewAI</span>
          </div>

          {/* Termination notice */}
          {terminated && (
            <div style={{ background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.25)", borderRadius:12, padding:"14px 20px", marginBottom:24, display:"flex", alignItems:"center", gap:12 }}>
              <span style={{ fontSize:22 }}>🚨</span>
              <div>
                <div style={{ fontWeight:700, color:"#ef4444", fontSize:14, marginBottom:3 }}>Interview Terminated — Proctoring Violations</div>
                <div style={{ fontSize:13, color:"#64748b" }}>Received {violationCount} violations. Score based on {qs.length} completed questions.</div>
              </div>
            </div>
          )}

          {/* Candidate card */}
          <div style={{ background:"#090f1e", border:"1px solid #1a2540", borderRadius:14, padding:"16px 20px", marginBottom:24, display:"flex", alignItems:"center", gap:14 }}>
            <div style={{ width:44, height:44, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:18, fontWeight:800, flexShrink:0 }}>
              {session.candidate.name?.[0]?.toUpperCase()}
            </div>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:700, color:"#e2e8f0", fontSize:15 }}>{session.candidate.name}</div>
              <div style={{ fontSize:13, color:"#475569", marginTop:1 }}>{roleName} · {expName}</div>
            </div>
            <div style={{ textAlign:"right" }}>
              <div style={{ fontSize:11, color:"#2a3a5c", fontWeight:600, textTransform:"uppercase", letterSpacing:0.8 }}>Violations</div>
              <div style={{ fontSize:20, fontWeight:800, color: violationCount>0?"#ef4444":"#22c55e" }}>{violationCount}</div>
            </div>
          </div>

          {/* Score */}
          <div style={{ textAlign:"center", margin:"8px 0 32px" }}>
            <div style={{ fontSize:44, marginBottom:10 }}>{terminated?"🚫":avgScore>=7?"🎉":avgScore>=4?"👍":"📖"}</div>
            <h2 style={{ fontSize:24, fontWeight:800, margin:"0 0 6px", color:"#e2e8f0" }}>
              {terminated ? `Interview Ended, ${session.candidate.name}` : `Well done, ${session.candidate.name}!`}
            </h2>
            <p style={{ color:"#475569", marginBottom:24 }}>{roleName} · {qs.length}/{TOTAL_QUESTIONS} questions answered</p>
            {qs.length > 0 && (
              <div style={{ display:"inline-flex", gap:14, alignItems:"center", background:gc+"12", border:`1px solid ${gc}30`, borderRadius:14, padding:"14px 28px" }}>
                <div style={{ fontSize:38, fontWeight:800, color:gc }}>{avgScore}</div>
                <div style={{ textAlign:"left" }}>
                  <div style={{ fontSize:16, fontWeight:700, color:gc }}>{grade}</div>
                  <div style={{ fontSize:12, color:"#475569" }}>Average / 10</div>
                </div>
              </div>
            )}
          </div>

          {/* Topics covered */}
          {session.coveredTopics.length > 0 && (
            <div style={{ marginBottom:20 }}>
              <div style={{ fontSize:11, color:"#2a3a5c", fontWeight:700, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>Topics Covered</div>
              <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
                {session.coveredTopics.map((t,i) => (
                  <span key={i} style={{ fontSize:12, color:"#6366f1", background:"#6366f112", border:"1px solid #6366f128", borderRadius:6, padding:"3px 10px", fontWeight:600 }}>{t}</span>
                ))}
              </div>
            </div>
          )}

          {/* Per-question results */}
          <div style={{ display:"flex", flexDirection:"column", gap:10, marginBottom:28 }}>
            {qs.map((q, i) => {
              const sc = q.aiScore>=7?"#22c55e":q.aiScore>=4?"#f59e0b":"#ef4444";
              return (
                <div key={i} style={{ background:"#090f1e", border:`1px solid ${sc}22`, borderRadius:12, padding:"14px 18px" }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:7 }}>
                    <span style={{ fontSize:11, color:q.isFollowUp?"#6366f1":"#475569", textTransform:"uppercase", letterSpacing:1, fontWeight:700 }}>
                      {q.isFollowUp ? "Follow-up" : `Q${i+1}`} · {q.topic}
                    </span>
                    <span style={{ fontSize:14, fontWeight:800, color:sc }}>{q.aiScore}/10</span>
                  </div>
                  <div style={{ fontSize:14, color:"#64748b", marginBottom:6, lineHeight:1.55 }}>{q.text}</div>
                  <div style={{ fontSize:13, color:"#94a3b8", lineHeight:1.6 }}>{q.aiFeedback}</div>
                </div>
              );
            })}
          </div>

          {/* Violation log */}
          {session.violations.length > 0 && (
            <div style={{ marginBottom:28 }}>
              <div style={{ fontSize:11, color:"#ef4444", fontWeight:700, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>Violation Log</div>
              <div style={{ background:"#090f1e", border:"1px solid #ef444422", borderRadius:10, overflow:"hidden" }}>
                {session.violations.map((v, i) => (
                  <div key={i} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"8px 14px", borderBottom:i<session.violations.length-1?"1px solid #0c1526":"none" }}>
                    <span style={{ fontSize:12, color:"#ef4444", fontWeight:700 }}>{v.type.replace(/_/g," ").toUpperCase()}</span>
                    <span style={{ fontSize:11, color:"#2a3a5c" }}>{new Date(v.time).toLocaleTimeString()}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div style={{ display:"flex", gap:10 }}>
            <button style={{ flex:1, padding:"13px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer" }} onClick={doReset}>Try Again</button>
            <button style={{ flex:1, padding:"13px", borderRadius:10, border:"1px solid #1a2540", background:"transparent", color:"#64748b", fontSize:14, fontWeight:600, cursor:"pointer" }} onClick={doReset}>New Session</button>
          </div>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RENDER: INTERVIEW
  // ─────────────────────────────────────────────────────────────────────────
  const isFollowUpQ   = question?.topic === "Follow-up";
  const displayAnswer = answer + (liveTranscript ? (answer ? " " : "") + liveTranscript : "");
  const canToggleMic  = !aiSpeaking && !loading && !evaluation;
  const canSubmit     = !aiSpeaking && !loading && !evaluation && displayAnswer.trim().length > 0;
  const roleName      = JOB_ROLES.find(r => r.id===session.candidate.role)?.label || "";

  return (
    <div style={{ height:"100vh", background:"#050a14", color:"#e2e8f0", fontFamily:"system-ui,-apple-system,sans-serif", display:"flex", flexDirection:"column", overflow:"hidden" }}>
      <style>{CSS}</style>
      <ToastContainer toasts={toasts} />
      <ProctorOverlay
        active={true}
        onTerminate={handleProctorTerminate}
        addViolation={addViolation}
        warnCount={warnCount}
        setWarnCount={setWarnCount}
      />

      {/* ── Header ── */}
      <div style={{ height:54, padding:"0 24px", borderBottom:"1px solid #0c1526", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0, background:"#060c18" }}>
        {/* Left: branding + candidate info */}
        <div style={{ display:"flex", alignItems:"center", gap:10 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:"#6366f1", boxShadow:"0 0 7px #6366f1" }} />
          <span style={{ fontSize:13, fontWeight:700, color:"#475569" }}>InterviewAI</span>
          <span style={{ color:"#1a2540", margin:"0 2px" }}>·</span>
          <span style={{ fontSize:13, fontWeight:600, color:"#94a3b8" }}>{session.candidate.name}</span>
          <div style={{ fontSize:11, fontWeight:700, color:"#6366f1", background:"#6366f112", border:"1px solid #6366f128", borderRadius:6, padding:"2px 8px" }}>{roleName}</div>
        </div>

        {/* Right: violations + progress */}
        <div style={{ display:"flex", alignItems:"center", gap:14 }}>
          {/* Violations badge */}
          <div style={{
            display:"flex", alignItems:"center", gap:5,
            background: violationCount>0 ? "rgba(239,68,68,0.1)" : "rgba(255,255,255,0.02)",
            border: `1px solid ${violationCount>0?"rgba(239,68,68,0.3)":"#1a2540"}`,
            borderRadius:8, padding:"3px 10px",
          }}>
            <span style={{ fontSize:11, fontWeight:700, color:violationCount>0?"#ef4444":"#2a3a5c" }}>
              Violations: {violationCount}
            </span>
          </div>

          {/* Q counter + progress bars */}
          <div style={{ display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ fontSize:12, color:"#2a3a5c", fontWeight:600 }}>Q{qSlot}/{TOTAL_QUESTIONS}</span>
            <div style={{ display:"flex", gap:3 }}>
              {Array.from({ length: TOTAL_QUESTIONS }).map((_,i) => (
                <div key={i} style={{
                  width:24, height:4, borderRadius:2, transition:"background 0.3s",
                  background: i < session.questions.length ? "#6366f1"
                    : i === qSlot-1 ? "#6366f130"
                    : "#0c1526",
                }} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ── Body ── */}
      <div style={{ flex:1, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"20px", gap:14, overflow:"auto" }}>

        {/* Question card */}
        <div style={{ width:"100%", maxWidth:740, background:"#090f1e", border:"1px solid #0c1526", borderRadius:20, padding:"24px 32px" }}>
          <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:14 }}>
            <div style={{
              width:40, height:40, borderRadius:"50%", flexShrink:0,
              fontSize:13, fontWeight:700,
              background:"linear-gradient(135deg,#6366f1,#8b5cf6)", color:"#fff",
              display:"flex", alignItems:"center", justifyContent:"center",
              boxShadow: aiSpeaking ? "0 0 22px #6366f155" : "none",
              transition:"box-shadow 0.3s",
            }}>AI</div>
            <div>
              <div style={{ fontSize:13, fontWeight:600, color:"#c4cfe0" }}>AI Interviewer</div>
              <div style={{ fontSize:12, color: aiSpeaking?"#6366f1":loading?"#f59e0b":"#2a3a5c" }}>
                {loading?"thinking…":aiSpeaking?"speaking…":micOn?"listening…":"—"}
              </div>
            </div>
            {isFollowUpQ && (
              <div style={{ fontSize:11, color:"#6366f1", background:"#6366f112", borderRadius:6, padding:"3px 10px", border:"1px solid #6366f128" }}>follow-up</div>
            )}
            {question?.topic && !isFollowUpQ && (
              <div style={{ fontSize:11, color:"#475569", background:"#0c1526", borderRadius:6, padding:"3px 10px", border:"1px solid #1a2540" }}>{question.topic}</div>
            )}
            <div style={{ marginLeft:"auto" }}><Waveform active={aiSpeaking} color="#6366f1" /></div>
          </div>
          {loading && !question ? (
            <div style={{ display:"flex", gap:5, alignItems:"center", padding:"4px 0" }}>
              <span className="da"/><span className="db"/><span className="dc"/>
              <span style={{ color:"#2a3a5c", fontSize:15, marginLeft:6 }}>Preparing question…</span>
            </div>
          ) : (
            <p style={{ fontSize:19, lineHeight:1.75, color:"#dde4f0", margin:0, fontWeight:400 }}>
              {question?.question}
            </p>
          )}
        </div>

        {/* Answer card */}
        <div style={{ width:"100%", maxWidth:740, background:"#090f1e", border:`1px solid ${micOn?"#6366f133":"#0c1526"}`, borderRadius:20, padding:"20px 32px", transition:"border-color 0.2s" }}>
          {!evaluation ? (
            <>
              <div style={{ display:"flex", alignItems:"center", gap:14, marginBottom:14 }}>
                {/* Mic button */}
                <button
                  onClick={canToggleMic ? toggleMic : undefined}
                  disabled={!canToggleMic}
                  title={micOn ? "Stop mic" : "Start mic"}
                  style={{
                    width:48, height:48, borderRadius:"50%", flexShrink:0,
                    background: micOn ? (userTalking?"#22c55e10":"#6366f110") : "#0c1526",
                    border: `2px solid ${micOn?(userTalking?"#22c55e":"#6366f1"):"#1a2540"}`,
                    display:"flex", alignItems:"center", justifyContent:"center",
                    fontSize:18, position:"relative", transition:"all 0.25s",
                    cursor: canToggleMic ? "pointer" : "not-allowed",
                    outline:"none",
                    boxShadow: micOn ? "0 0 16px rgba(99,102,241,0.28)" : "none",
                  }}>
                  {micOn && <div className="pring" style={{ borderColor:userTalking?"#22c55e":"#6366f1" }} />}
                  {loading||aiSpeaking ? "⏳" : micOn ? (userTalking?"🗣":"👂") : "🎤"}
                </button>

                <div style={{ flex:1 }}>
                  {aiSpeaking
                    ? <div style={{ fontSize:13, color:"#2a3a5c" }}>AI is speaking…</div>
                    : micOn ? (
                      <div>
                        <div style={{ fontSize:14, fontWeight:500, color:userTalking?"#22c55e":"#6366f1" }}>
                          {userTalking ? "Capturing speech…" : "Listening — speak clearly"}
                        </div>
                        {silenceSec !== null && (
                          <div style={{ fontSize:12, color:"#f59e0b", marginTop:3 }}>
                            Auto-submit in {silenceSec}s… keep talking to cancel
                          </div>
                        )}
                        {sttConf !== null && (
                          <div style={{ fontSize:11, color:sttConf>80?"#22c55e":sttConf>60?"#f59e0b":"#ef4444", marginTop:2 }}>
                            STT confidence: {sttConf}%
                          </div>
                        )}
                      </div>
                    ) : loading
                      ? <div style={{ fontSize:13, color:"#2a3a5c" }}>Processing…</div>
                      : <div style={{ fontSize:13, color:"#475569" }}>Click 🎤 to speak, or type below</div>
                  }
                </div>
                <Waveform active={micOn && userTalking} color="#22c55e" bars={14} />
              </div>

              {/* Live transcript preview */}
              {displayAnswer && (
                <div style={{ background:"#060c18", border:"1px solid #1a2540", borderRadius:10, padding:"12px 16px", fontSize:15, color:"#94a3b8", lineHeight:1.65, marginBottom:12, minHeight:52 }}>
                  {answer && <span style={{ color:"#c4d0e8" }}>{answer}</span>}
                  {liveTranscript && <span style={{ color:"#4a5a7a", fontStyle:"italic" }}>{answer?" ":""}{liveTranscript}</span>}
                </div>
              )}

              <textarea
                value={answer}
                onChange={e => setAnswer(e.target.value)}
                placeholder="Type your answer here, or use the mic above…"
                style={{ width:"100%", minHeight:80, background:"transparent", border:"1px solid #1a2540", borderRadius:10, padding:"10px 14px", color:"#94a3b8", fontSize:14, fontFamily:"inherit", lineHeight:1.6, resize:"vertical", outline:"none", boxSizing:"border-box" }}
              />
            </>
          ) : (
            <div>
              <div style={{ fontSize:11, color:"#2a3a5c", textTransform:"uppercase", letterSpacing:1, fontWeight:700, marginBottom:10 }}>Feedback</div>
              <p style={{ fontSize:15, color:"#94a3b8", lineHeight:1.75, margin:0 }}>{evaluation.feedback}</p>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display:"flex", gap:12 }}>
          {!evaluation && (
            <button
              onClick={canSubmit ? manualSubmit : undefined}
              disabled={!canSubmit}
              style={{
                minWidth:180, padding:"13px 28px", borderRadius:10, border:"none",
                background: canSubmit ? "linear-gradient(135deg,#6366f1,#8b5cf6)" : "#1a2540",
                color: canSubmit ? "#fff" : "#2a3a5c",
                fontSize:14, fontWeight:700,
                cursor: canSubmit ? "pointer" : "not-allowed",
                transition:"all 0.2s",
                boxShadow: canSubmit ? "0 4px 18px rgba(99,102,241,0.3)" : "none",
              }}>
              Submit Answer
            </button>
          )}
          {evaluation && (
            <button
              onClick={manualNext}
              className="abtn"
              style={{ minWidth:200, padding:"13px 28px", borderRadius:10, border:"none", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", color:"#fff", fontSize:14, fontWeight:700, cursor:"pointer", boxShadow:"0 4px 18px rgba(99,102,241,0.3)" }}>
              {qSlot >= TOTAL_QUESTIONS ? "See Results →" : "Continue →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCTOR GATE  (verification screen shown before interview starts)
// ─────────────────────────────────────────────────────────────────────────────
function ProctorGate({ candidate, onComplete, addViolation }) {
  const videoRef  = useRef(null);
  const mpCamRef  = useRef(null);
  const holdRef   = useRef(0);
  const lastTRef  = useRef(null);
  const doneRef   = useRef(false);
  const HOLD_MS   = 3000;

  const [camReady, setCamReady] = useState(false);
  const [mpReady,  setMpReady]  = useState(false);
  const [status,   setStatus]   = useState("noface");
  const [progress, setProgress] = useState(0);
  const [camError, setCamError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await loadMediaPipe();
        if (cancelled) return;
        const fm = new window.FaceMesh({ locateFile: f => "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/" + f });
        fm.setOptions({ maxNumFaces: 2, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        fm.onResults(results => {
          if (doneRef.current) return;
          const now   = Date.now();
          const delta = lastTRef.current ? now - lastTRef.current : 16;
          lastTRef.current = now;

          const count = results.multiFaceLandmarks?.length || 0;
          let nextStatus = "noface";

          if (count > 1) {
            nextStatus = "multiface";
          } else if (count === 1) {
            const lm   = results.multiFaceLandmarks[0];
            const fh   = lm[10], nose=lm[1], chin=lm[152], le=lm[159], re=lm[386];
            const faceH = chin.y - fh.y;
            const ratio = faceH > 0 ? (nose.y - fh.y) / faceH : 0;
            const eyeRel = faceH > 0 ? ((le.y+re.y)/2 - fh.y) / faceH : 1;
            const ok = faceH>0.15 && fh.y>0.05 && chin.y<0.92 && ratio>0.42 && eyeRel>0.25 && eyeRel<0.62;
            nextStatus = ok ? "ok" : faceH > 0.05 ? "lookdown" : "noface";
          }
          setStatus(nextStatus);

          if (nextStatus === "ok") holdRef.current = Math.min(HOLD_MS, holdRef.current + delta);
          else holdRef.current = Math.max(0, holdRef.current - delta * (nextStatus==="lookdown"?2.5:1.5));

          const pct = Math.round((holdRef.current / HOLD_MS) * 100);
          setProgress(pct);

          if (holdRef.current >= HOLD_MS && !doneRef.current) {
            doneRef.current = true;
            try { mpCamRef.current?.stop(); } catch {}
            setTimeout(onComplete, 500);
          }
        });
        const cam = new window.Camera(videoRef.current, {
          onFrame: async () => { if (videoRef.current) await fm.send({ image: videoRef.current }); },
          width: 1280, height: 720,
        });
        mpCamRef.current = cam;
        await cam.start();
        setCamReady(true); setMpReady(true);
      } catch {
        if (!cancelled) setCamError("Camera unavailable. Check permissions and reload.");
      }
    })();
    return () => { cancelled = true; try { mpCamRef.current?.stop(); } catch {} };
  }, [onComplete]);

  const RX = 148, RY = 190;
  const CIRC = Math.PI * (3*(RX+RY) - Math.sqrt((3*RX+RY)*(RX+3*RY)));
  const ringColor = status==="ok"&&progress>0
    ? progress<50?"#3b82f6":progress<85?"#34d399":"#10b981"
    : "#1e3a5f";

  const statusInfo = {
    noface:    { msg: !camReady?"Starting camera…":"Place your face in the oval", color:"#93c5fd" },
    lookdown:  { msg: "Look straight at the screen",      color:"#fbbf24" },
    multiface: { msg: "Only you should be visible",       color:"#ef4444" },
    ok:        { msg: progress>=100?"Verified!":"Perfect, hold still…", color:"#34d399" },
  }[status] || { msg:"…", color:"#93c5fd" };

  const roleName = JOB_ROLES.find(r => r.id===candidate.role)?.label || "";
  const expName  = EXP_LEVELS.find(e => e.id===candidate.experience)?.label || "";

  return (
    <div style={{ minHeight:"100vh", background:"#050b14", color:"#e2e8f0", display:"flex", flexDirection:"column", fontFamily:"system-ui,-apple-system,sans-serif" }}>
      <style>{CSS}</style>
      {/* Header */}
      <div style={{ height:52, background:"#060d1a", borderBottom:"1px solid #0d1f33", display:"flex", alignItems:"center", justifyContent:"space-between", padding:"0 28px", flexShrink:0 }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <div style={{ width:8, height:8, borderRadius:"50%", background:"#3b82f6", boxShadow:"0 0 8px #3b82f6" }} />
          <span style={{ fontWeight:800, fontSize:14, color:"#60a5fa" }}>InterviewAI</span>
        </div>
        <div style={{ fontSize:12, fontWeight:600, color:"#10b981", background:"rgba(16,185,129,0.07)", border:"1px solid rgba(16,185,129,0.18)", padding:"5px 12px", borderRadius:20, display:"flex", alignItems:"center", gap:6 }}>
          <span style={{ width:6, height:6, borderRadius:"50%", background:"#10b981", display:"inline-block" }} /> Proctor Active
        </div>
      </div>

      {/* Layout */}
      <div style={{ flex:1, display:"flex", alignItems:"center", justifyContent:"center", gap:60, padding:"32px 48px", flexWrap:"wrap" }}>
        {/* Left panel */}
        <div style={{ maxWidth:300, display:"flex", flexDirection:"column", gap:16 }}>
          {/* Candidate info */}
          <div style={{ background:"#090f1e", border:"1px solid #1a2540", borderRadius:12, padding:"14px 16px", display:"flex", alignItems:"center", gap:12, marginBottom:4 }}>
            <div style={{ width:38, height:38, borderRadius:"50%", background:"linear-gradient(135deg,#6366f1,#8b5cf6)", display:"flex", alignItems:"center", justifyContent:"center", fontSize:16, fontWeight:800, flexShrink:0 }}>
              {candidate.name?.[0]?.toUpperCase()}
            </div>
            <div>
              <div style={{ fontWeight:700, color:"#e2e8f0", fontSize:14 }}>{candidate.name}</div>
              <div style={{ fontSize:12, color:"#475569", marginTop:1 }}>{roleName} · {expName}</div>
            </div>
          </div>

          <h2 style={{ fontSize:22, fontWeight:800, color:"#f1f5f9", margin:0 }}>Camera Verification</h2>
          <p style={{ color:"#374e6a", fontSize:14, lineHeight:1.65, margin:0 }}>
            Look straight at the camera with your full face visible in the oval. Hold still for 3 seconds to begin.
          </p>

          {/* Check rows */}
          {[
            { label:"Camera active",       done:camReady,                        spin:!camReady },
            { label:"Face detected",       done:status!=="noface"&&camReady,     spin:camReady&&status==="noface" },
            { label:"Looking straight",    done:status==="ok",                   warn:status==="lookdown"||status==="multiface", warnMsg: status==="multiface"?"Only you should be visible":"Look straight at screen" },
            { label:`Hold steady (${Math.min(3,holdRef.current/1000).toFixed(1)}s / 3.0s)`, done:progress>=100, spin:status==="ok"&&progress>0&&progress<100 },
          ].map((row, i) => (
            <div key={i} style={{ display:"flex", alignItems:"center", gap:10, padding:"10px 14px", borderRadius:8, background:row.done?"rgba(16,185,129,0.07)":row.warn?"rgba(251,191,36,0.07)":"rgba(255,255,255,0.02)", border:`1px solid ${row.done?"rgba(16,185,129,0.22)":row.warn?"rgba(251,191,36,0.2)":"rgba(255,255,255,0.04)"}`, transition:"all 0.3s" }}>
              <div style={{ width:20, height:20, borderRadius:"50%", border:`2px solid ${row.done?"#10b981":row.warn?"#fbbf24":"#1e293b"}`, background:row.done?"#10b981":row.warn?"#fbbf24":"transparent", display:"flex", alignItems:"center", justifyContent:"center", fontSize:10, color:"#fff", flexShrink:0 }}>
                {row.done ? "✓" : row.warn ? "!" : row.spin ? <span style={{ width:7, height:7, borderRadius:"50%", border:"2px solid #3b82f6", borderTopColor:"transparent", display:"block", animation:"spinDot 0.7s linear infinite" }} /> : null}
              </div>
              <span style={{ fontSize:13, fontWeight:600, color:row.done?"#10b981":row.warn?"#fbbf24":"#1e293b" }}>
                {row.warn && row.warnMsg ? row.warnMsg : row.label}
              </span>
            </div>
          ))}

          {/* Status pill */}
          <div style={{ padding:"10px 16px", borderRadius:8, fontSize:13, fontWeight:700, textAlign:"center", border:`1px solid ${statusInfo.color}44`, background:`${statusInfo.color}12`, color:statusInfo.color, transition:"all 0.3s" }}>
            {!mpReady && !camError ? "Loading face detection…" : statusInfo.msg}
          </div>

          {camError && (
            <div style={{ background:"rgba(239,68,68,0.07)", border:"1px solid rgba(239,68,68,0.2)", color:"#f87171", padding:"10px 14px", borderRadius:8, fontSize:13, lineHeight:1.5 }}>{camError}</div>
          )}
        </div>

        {/* Camera oval */}
        <div style={{ position:"relative", width:320, height:400, flexShrink:0 }}>
          <div style={{ position:"absolute", inset:0, overflow:"hidden", clipPath:"ellipse(148px 190px at 50% 50%)", background:"#060d1a" }}>
            <video ref={videoRef} autoPlay muted playsInline style={{ width:"100%", height:"100%", objectFit:"cover", transform:"scaleX(-1)" }} />
            {camReady && status !== "ok" && <div style={{ position:"absolute", inset:0, background:"rgba(5,11,20,0.38)" }} />}
          </div>
          <svg width={320} height={400} viewBox="0 0 320 400" style={{ position:"absolute", inset:0, pointerEvents:"none" }}>
            <ellipse cx={160} cy={200} rx={RX} ry={RY} fill="none" stroke="rgba(255,255,255,0.07)" strokeWidth={1.5} strokeDasharray="5 4" />
            <ellipse cx={160} cy={200} rx={RX} ry={RY} fill="none" stroke={ringColor} strokeWidth={3.5} strokeLinecap="round"
              strokeDasharray={CIRC} strokeDashoffset={CIRC*(1-progress/100)}
              transform="rotate(-90 160 200)" style={{ transition:"stroke-dashoffset 0.15s linear, stroke 0.4s" }}
            />
            {progress > 3 && progress < 100 && (
              <text x={160} y={395} textAnchor="middle" fill={ringColor} fontSize={11} fontFamily="monospace" fontWeight="bold">{progress}%</text>
            )}
          </svg>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SHARED STYLES
// ─────────────────────────────────────────────────────────────────────────────
const LS = {
  label: { display:"block", fontSize:11, fontWeight:700, color:"#475569", textTransform:"uppercase", letterSpacing:1, marginBottom:8 },
  input: { width:"100%", padding:"12px 16px", fontSize:14, background:"#060c18", border:"1px solid #1a2540", borderRadius:10, color:"#e2e8f0", outline:"none", fontFamily:"inherit", boxSizing:"border-box", marginBottom:22 },
};

const CSS = `
  @keyframes toastIn  { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:none} }
  @keyframes spinDot  { to{transform:rotate(360deg)} }
  * { box-sizing: border-box; }
  body { margin: 0; background: #050a14; }
  textarea { resize: vertical; }
  textarea:focus { border-color: #6366f1 !important; outline: none; }
  input:focus    { border-color: #6366f1 !important; outline: none; }
  .abtn { transition: all 0.15s; }
  .abtn:hover:not(:disabled) { opacity: 0.82; transform: translateY(-1px); }
  @keyframes pa { 0%{transform:scale(1);opacity:.65} 100%{transform:scale(2);opacity:0} }
  .pring { position:absolute;inset:-5px;border-radius:50%;border:2px solid;animation:pa 1.3s ease-out infinite;pointer-events:none; }
  @keyframes bl { 0%,80%,100%{opacity:.18;transform:scale(.8)} 40%{opacity:1;transform:scale(1)} }
  .da,.db,.dc { width:7px;height:7px;border-radius:50%;background:#6366f1;display:inline-block; }
  .da{animation:bl 1.4s ease-in-out infinite}
  .db{animation:bl 1.4s ease-in-out .2s infinite}
  .dc{animation:bl 1.4s ease-in-out .4s infinite}
`;