/* eslint-disable react-hooks/exhaustive-deps */
import { useState, useEffect, useRef, useCallback } from "react";

const BACKEND_URL     = "http://localhost:8000";
const TOTAL_QUESTIONS = 6;
const SILENCE_MS      = 3000;
const MAX_WARNINGS    = 115; 

const DOMAINS = [
  { id: "frontend",        label: "Frontend Development",         sub: "HTML, CSS, JavaScript, React" },
  { id: "backend",         label: "Backend Development",          sub: "APIs, Databases, System Design" },
  { id: "ai",              label: "AI & Machine Learning",        sub: "Models, Training, Neural Networks" },
  { id: "data_structures", label: "Data Structures & Algorithms", sub: "Arrays, Trees, Graphs, Complexity" },
];

// ─────────────────────────────────────────────────────────────────────────────
// PROCTOR HOOK
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
      s2.onload = () => { window._mpReady = true; resolve(); };
      s2.onerror = reject;
      document.head.appendChild(s2);
    };
    s1.onerror = reject;
    document.head.appendChild(s1);
  });
}

function useProctor(active) {
  const videoRef   = useRef(null);
  const mpCamRef   = useRef(null);
  const mountedRef = useRef(false);
  const [status, setStatus] = useState("noface");
  const [ready,  setReady]  = useState(false);
  const [error,  setError]  = useState("");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (mpCamRef.current) { try { mpCamRef.current.stop(); } catch {} }
    };
  }, []);

  useEffect(() => {
    if (!active) {
      if (mpCamRef.current) { try { mpCamRef.current.stop(); } catch {} mpCamRef.current = null; }
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
        fm.setOptions({ maxNumFaces: 1, refineLandmarks: false, minDetectionConfidence: 0.5, minTrackingConfidence: 0.5 });
        fm.onResults(results => {
          if (!mountedRef.current) return;
          let next = "noface";
          if (results.multiFaceLandmarks?.length > 0) {
            const lm = results.multiFaceLandmarks[0];
            const forehead = lm[10], nose = lm[1], chin = lm[152], leftEye = lm[159], rightEye = lm[386];
            const faceH = chin.y - forehead.y;
            const large       = faceH > 0.15;
            const fhVisible   = forehead.y > 0.05;
            const chinVisible = chin.y < 0.92;
            const ratio       = faceH > 0 ? (nose.y - forehead.y) / faceH : 0;
            const upright     = ratio > 0.42;
            const eyeAvgY     = (leftEye.y + rightEye.y) / 2;
            const eyeRel      = faceH > 0 ? (eyeAvgY - forehead.y) / faceH : 1;
            const eyesOk      = eyeRel > 0.25 && eyeRel < 0.62;
            if (large && fhVisible && chinVisible && upright && eyesOk) next = "ok";
            else if (faceH > 0.05) next = "lookdown";
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
      if (mpCamRef.current) { try { mpCamRef.current.stop(); } catch {} mpCamRef.current = null; }
    };
  }, [active]);

  return { videoRef, status, ready, error };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROCTOR OVERLAY — counts warnings, calls onTerminate at MAX_WARNINGS
// ─────────────────────────────────────────────────────────────────────────────
function ProctorOverlay({ active, onTerminate }) {
  const { videoRef, status, ready, error } = useProctor(active);
  const [collapsed,    setCollapsed]    = useState(false);
  const [alertVisible, setAlertVisible] = useState(false);
  const [warnCount,    setWarnCount]    = useState(0);
  const alertTimerRef = useRef(null);
  const prevStatus    = useRef(status);

  useEffect(() => {
    if (status === "lookdown" && prevStatus.current !== "lookdown") {
      setWarnCount(prev => {
        const next = prev + 1;
        if (next >= MAX_WARNINGS) {
          // slight delay so the banner flashes once before termination
          setTimeout(() => onTerminate?.(), 1800);
        }
        return next;
      });
      setAlertVisible(true);
      clearTimeout(alertTimerRef.current);
      alertTimerRef.current = setTimeout(() => setAlertVisible(false), 4000);
    }
    if (status === "ok") {
      clearTimeout(alertTimerRef.current);
      setAlertVisible(false);
    }
    prevStatus.current = status;
  }, [status]);

  useEffect(() => () => clearTimeout(alertTimerRef.current), []);

  if (!active) return null;

  const remaining = MAX_WARNINGS - warnCount;
  const dotColor =
    !ready               ? "#475569" :
    status === "ok"       ? "#22c55e" :
    status === "lookdown" ? "#f59e0b" : "#ef4444";

  const dotLabel =
    !ready               ? "Loading…"         :
    error                ? "Camera error"     :
    status === "ok"       ? "Looking straight" :
    status === "lookdown" ? "Look at screen"   : "No face detected";

  return (
    <>
      {/* ── Alert banner ── */}
      <div style={{ position: "fixed", top: 0, left: 0, right: 0, zIndex: 1001, display: "flex", justifyContent: "center", pointerEvents: "none" }}>
        <div style={{
          background: warnCount >= MAX_WARNINGS ? "#ef4444" : "#f59e0b",
          color: "#000", fontWeight: 700, fontSize: 14,
          padding: "10px 28px", borderRadius: "0 0 14px 14px",
          boxShadow: "0 4px 24px rgba(245,158,11,0.4)",
          display: "flex", alignItems: "center", gap: 10,
          transform: alertVisible ? "translateY(0)" : "translateY(-110%)",
          transition: "transform 0.35s cubic-bezier(.22,1,.36,1)",
          pointerEvents: "none",
        }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          {warnCount >= MAX_WARNINGS
            ? "Too many violations — terminating interview…"
            : `Please look straight at the screen to continue your interview (Warning ${warnCount}/${MAX_WARNINGS})`}
        </div>
      </div>

      {/* ── Camera widget ── */}
      <div style={{ position: "fixed", bottom: 24, right: 24, zIndex: 1000, display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 8, fontFamily: "system-ui,-apple-system,sans-serif" }}>
        {collapsed ? (
          <button onClick={() => setCollapsed(false)} style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "#090f1e", border: `1.5px solid ${dotColor}44`,
            borderRadius: 24, padding: "7px 14px 7px 10px",
            cursor: "pointer", color: "#e2e8f0", fontSize: 13, fontWeight: 600,
            boxShadow: "0 4px 18px rgba(0,0,0,0.5)",
          }}>
            <span style={{ width: 9, height: 9, borderRadius: "50%", background: dotColor, flexShrink: 0, boxShadow: `0 0 7px ${dotColor}` }} />
            Proctor
            {warnCount > 0 && (
              <span style={{ marginLeft: 4, background: warnCount >= MAX_WARNINGS ? "#ef4444" : "#f59e0b", color: "#000", borderRadius: 10, fontSize: 11, fontWeight: 700, padding: "1px 7px" }}>
                {warnCount}/{MAX_WARNINGS}
              </span>
            )}
          </button>
        ) : (
          <div style={{
            background: "#090f1e",
            border: `1.5px solid ${status === "lookdown" ? "#f59e0b55" : status === "ok" ? "#22c55e33" : "#1a2540"}`,
            borderRadius: 16, overflow: "hidden", width: 200,
            boxShadow: status === "lookdown" ? "0 0 0 2px #f59e0b55, 0 8px 32px rgba(0,0,0,0.6)" : "0 8px 32px rgba(0,0,0,0.6)",
            transition: "border-color 0.3s, box-shadow 0.3s",
          }}>
            {/* Header */}
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "7px 10px", borderBottom: "1px solid #0c1526", background: "#060c18" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: dotColor, boxShadow: `0 0 6px ${dotColor}`, flexShrink: 0 }} />
                <span style={{ fontSize: 11, fontWeight: 600, color: "#64748b" }}>Proctor</span>
                {/* Warning counter pill */}
                {warnCount > 0 && (
                  <span style={{
                    fontSize: 10, fontWeight: 700, padding: "1px 6px", borderRadius: 8,
                    background: remaining <= 1 ? "#ef444422" : "#f59e0b22",
                    color: remaining <= 1 ? "#ef4444" : "#f59e0b",
                    border: `1px solid ${remaining <= 1 ? "#ef444444" : "#f59e0b44"}`,
                  }}>
                    {warnCount}/{MAX_WARNINGS}
                  </span>
                )}
              </div>
              <button onClick={() => setCollapsed(true)} style={{ background: "none", border: "none", color: "#2a3a5c", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>—</button>
            </div>

            {/* Video */}
            <div style={{ position: "relative", width: 200, height: 150, background: "#060c18" }}>
              <video ref={videoRef} autoPlay muted playsInline style={{
                width: "100%", height: "100%", objectFit: "cover",
                transform: "scaleX(-1)", display: "block",
                opacity: ready ? 1 : 0, transition: "opacity 0.5s",
              }} />
              {ready && status !== "ok" && (
                <div style={{ position: "absolute", inset: 0, background: status === "lookdown" ? "rgba(245,158,11,0.12)" : "rgba(5,10,20,0.4)", transition: "background 0.3s" }} />
              )}
              {!ready && !error && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 11, color: "#2a3a5c" }}>Starting camera…</span>
                </div>
              )}
              {error && (
                <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontSize: 11, color: "#ef444488" }}>Camera unavailable</span>
                </div>
              )}
            </div>

            {/* Status bar */}
            <div style={{ padding: "6px 10px", display: "flex", alignItems: "center", justifyContent: "space-between", background: status === "lookdown" ? "rgba(245,158,11,0.08)" : "transparent", transition: "background 0.3s" }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: dotColor, transition: "color 0.3s" }}>
                {status === "lookdown" ? "⚠ " : ""}{dotLabel}
              </span>
              {warnCount > 0 && remaining > 0 && (
                <span style={{ fontSize: 10, color: remaining <= 2 ? "#ef4444" : "#64748b" }}>
                  {remaining} left
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN COMPONENT
// ─────────────────────────────────────────────────────────────────────────────
function Waveform({ active, color = "#6366f1", bars = 20 }) {
  const [h, setH] = useState(Array(bars).fill(4));
  useEffect(() => {
    if (!active) { setH(Array(bars).fill(4)); return; }
    const iv = setInterval(() => setH(Array(bars).fill(0).map(() => 4 + Math.random() * 26)), 80);
    return () => clearInterval(iv);
  }, [active, bars]);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 2, height: 34 }}>
      {h.map((v, i) => (
        <div key={i} style={{ width: 3, borderRadius: 2, background: color, height: v, transition: "height 0.08s ease", opacity: active ? 0.65 + (i % 3) * 0.12 : 0.12 }} />
      ))}
    </div>
  );
}

export default function AIInterview() {
  const [phase, setPhase]               = useState("intro");
  const [name, setName]                 = useState("");
  const [domain, setDomain]             = useState(null);
  const [question, setQuestion]         = useState(null);
  const [answer, setAnswer]             = useState("");
  const [liveTranscript, setLive]       = useState("");
  const [evaluation, setEval]           = useState(null);
  const [loading, setLoading]           = useState(false);
  const [aiSpeaking, setAiSpeak]        = useState(false);
  const [micOn, setMicOn]               = useState(false);
  const [userTalking, setTalking]       = useState(false);
  const [silenceSec, setSilSec]         = useState(null);
  const [qSlot, setQSlot]               = useState(1);
  const [usedFollowUp, setUsedFollowUp] = useState(false);
  const [results, setResults]           = useState([]);
  const [history, setHistory]           = useState([]);
  const [statusMsg, setStatus]          = useState("");

  const recognitionRef = useRef(null);
  const silTimerRef    = useRef(null);
  const silCountRef    = useRef(null);
  const ansRef         = useRef("");
  const submittingRef  = useRef(false);
  const micActiveRef   = useRef(false);
  const doSubmitRef    = useRef(null);
  const advanceRef     = useRef(null);

  ansRef.current       = answer;
  micActiveRef.current = micOn;

  // ── Proctor termination handler ───────────────────────────────────────────
  const handleProctorTerminate = useCallback(() => {
    // Stop everything and jump straight to results 
    window.speechSynthesis?.cancel();
    hardStopMic();
    setPhase("result");
  }, []);

  // ── TTS ───────────────────────────────────────────────────────────────────
  const speak = useCallback((text, onDone) => {
    if (!window.speechSynthesis) { onDone?.(); return; }
    window.speechSynthesis.cancel();
    setAiSpeak(true);
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1.05; u.pitch = 1.05; u.volume = 1;
    const pickVoice = () => {
      const vs = window.speechSynthesis.getVoices();
      const v = vs.find(x => x.name === "Google UK English Female" || x.name === "Google US English" || x.name.includes("Samantha") || x.name.includes("Karen"))
        || vs.find(x => x.lang.startsWith("en") && !x.localService) || vs[0];
      if (v) u.voice = v;
    };
    if (window.speechSynthesis.getVoices().length) pickVoice();
    else window.speechSynthesis.onvoiceschanged = pickVoice;
    u.onend   = () => { setAiSpeak(false); onDone?.(); };
    u.onerror = () => { setAiSpeak(false); onDone?.(); };
    window.speechSynthesis.speak(u);
  }, []);

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
      let c = 3; setSilSec(c);
      silCountRef.current = setInterval(() => {
        c -= 1; setSilSec(c);
        if (c <= 0) {
          clearInterval(silCountRef.current); setSilSec(null);
          if (ansRef.current.trim() && !submittingRef.current) {
            hardStopMic();
            doSubmitRef.current?.(ansRef.current.trim());
          }
        }
      }, 1000);
    }, SILENCE_MS);
  }, [clearSilence, hardStopMic]);

  const startMic = useCallback(() => {
    if (micActiveRef.current || submittingRef.current) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { setStatus("Speech recognition not supported. Please use Chrome and type your answer."); return; }
    setAnswer(""); setLive(""); setStatus("");
    const recognition = new SR();
    recognition.lang = "en-US"; recognition.continuous = true; recognition.interimResults = true; recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    recognition.onstart  = () => { setMicOn(true); micActiveRef.current = true; armSilence(); };
    recognition.onresult = (event) => {
      let interim = "", finalText = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalText += t + " "; else interim += t;
      }
      if (finalText) { setAnswer(prev => (prev + " " + finalText).trim()); setLive(""); armSilence(); }
      if (interim)   { setLive(interim); setTalking(true); armSilence(); setTimeout(() => setTalking(false), 800); }
    };
    recognition.onerror = (e) => {
      if (e.error === "no-speech") return;
      if (e.error === "not-allowed") setStatus("Mic access denied.");
      else setStatus(`Mic error: ${e.error}. You can type your answer below.`);
      hardStopMic();
    };
    recognition.onend = () => {
      if (micActiveRef.current && !submittingRef.current) { try { recognition.start(); } catch {} }
      else { setMicOn(false); micActiveRef.current = false; setTalking(false); setLive(""); }
    };
    try { recognition.start(); } catch { setStatus("Could not start mic. Please type your answer."); }
  }, [armSilence, hardStopMic]);

  const toggleMic = useCallback(() => { if (micOn) hardStopMic(); else startMic(); }, [micOn, hardStopMic, startMic]);

  useEffect(() => () => { hardStopMic(); window.speechSynthesis?.cancel(); }, [hardStopMic]);

  const api = async (ep, body) => {
    const r = await fetch(`${BACKEND_URL}${ep}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error(`${r.status}`);
    return r.json();
  };

  const generateQuestion = useCallback(async (dom, prevHistory, followUpText = null) => {
    setLoading(true); setEval(null); setAnswer(""); setLive("");
    submittingRef.current = false; hardStopMic(); window.speechSynthesis?.cancel();
    if (followUpText) {
      setQuestion({ question: followUpText, topic: "Follow-up", key_concepts: [] });
      setHistory(h => [...h, followUpText]);
      setLoading(false); speak(followUpText, () => startMic()); return;
    }
    try {
      const data = await api("/generate-question", { domain: dom, difficulty: "medium", topic: "", previous_questions: prevHistory });
      setQuestion(data); setHistory(h => [...h, data.question]);
      setLoading(false); speak(data.question, () => startMic());
    } catch { setLoading(false); setStatus("Backend error — is it running on :8000?"); }
  }, [speak, startMic, hardStopMic]);

  const doSubmit = useCallback(async (finalAnswer) => {
    if (submittingRef.current) return;
    submittingRef.current = true; hardStopMic(); setLoading(true); setStatus("");
    try {
      const data = await api("/evaluate-answer", { question: question?.question, answer: finalAnswer, domain, difficulty: "medium", attempt_number: 1 });
      setResults(prev => [...prev, { question: question?.question, answer: finalAnswer, score: data.score, topic: question?.topic, feedback: data.feedback, isFollowUp: question?.topic === "Follow-up" }]);
      setEval(data); setLoading(false);
      speak(data.feedback, () => setTimeout(() => advanceRef.current?.(data), 700));
    } catch { setStatus("Evaluation error. Try again."); submittingRef.current = false; setLoading(false); }
  }, [question, domain, speak, hardStopMic]);

  doSubmitRef.current = doSubmit;

  const manualSubmit = () => {
    const a = (ansRef.current + " " + liveTranscript).trim();
    if (!a) { setStatus("Say or type something first."); return; }
    clearSilence(); hardStopMic(); doSubmit(a);
  };

  const advance = useCallback((evalData) => {
    setEval(null); submittingRef.current = false;
    const canFollowUp = (evalData.next_action === "clarify" || evalData.next_action === "simplify") && evalData.follow_up_question && !usedFollowUp;
    setQSlot(prev => {
      const next = prev + 1;
      if (next > TOTAL_QUESTIONS) { setPhase("result"); return prev; }
      if (canFollowUp) { setUsedFollowUp(true); setHistory(h => { generateQuestion(domain, h, evalData.follow_up_question); return h; }); }
      else { setUsedFollowUp(false); setHistory(h => { generateQuestion(domain, h, null); return h; }); }
      return next;
    });
  }, [domain, generateQuestion, usedFollowUp]);

  advanceRef.current = advance;
  const manualNext = () => evaluation && advance(evaluation);

  const avgScore = results.length
    ? Math.round(results.reduce((s, r) => s + r.score, 0) / results.length * 10) / 10 : 0;

  const proctorActive = phase === "interview";

  // ── INTRO ─────────────────────────────────────────────────────────────────
  if (phase === "intro") return (
    <Shell>
      <Logo />
      <h1 style={T.h1}>Oral Technical<br /><span style={T.accent}>Interview</span></h1>
      <p style={T.sub}>Adaptive spoken questions — no writing, no coding.<br />Just clear verbal answers, like a real interview.</p>
      <input style={{ ...T.input, marginTop: 32, marginBottom: 14 }}
        placeholder="Your name" value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => e.key === "Enter" && name.trim() && setPhase("setup")} />
      <Btn disabled={!name.trim()} onClick={() => setPhase("setup")}>Continue</Btn>
    </Shell>
  );

  // ── SETUP ─────────────────────────────────────────────────────────────────
  if (phase === "setup") return (
    <Shell>
      <Logo />
      <h2 style={{ ...T.h1, fontSize: 26, marginBottom: 8 }}>Hi {name}!</h2>
      <p style={{ ...T.sub, marginBottom: 28 }}>
        Choose a domain. <strong style={{ color: "#e2e8f0" }}>{TOTAL_QUESTIONS} questions</strong> — adaptive and fully oral.
      </p>
      <div style={{ width: "100%", maxWidth: 500, display: "flex", flexDirection: "column", gap: 10 }}>
        {DOMAINS.map(d => (
          <div key={d.id} onClick={() => setDomain(d.id)} style={{
            padding: "14px 18px", borderRadius: 12, cursor: "pointer",
            border: `1.5px solid ${domain === d.id ? "#6366f1" : "#1a2540"}`,
            background: domain === d.id ? "#6366f110" : "#090f1e",
            display: "flex", alignItems: "center", gap: 14, transition: "all 0.15s",
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{d.label}</div>
              <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>{d.sub}</div>
            </div>
            <div style={{
              width: 18, height: 18, borderRadius: "50%",
              border: `2px solid ${domain === d.id ? "#6366f1" : "#2a3a5c"}`,
              background: domain === d.id ? "#6366f1" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {domain === d.id && <div style={{ width: 6, height: 6, borderRadius: "50%", background: "#fff" }} />}
            </div>
          </div>
        ))}
      </div>
      <Btn disabled={!domain} style={{ marginTop: 28, minWidth: 220 }}
        onClick={() => { setPhase("interview"); generateQuestion(domain, []); }}>
        Start Interview
      </Btn>
    </Shell>
  );

  // ── RESULT ────────────────────────────────────────────────────────────────
  if (phase === "result") {
    const terminated = results.length < TOTAL_QUESTIONS; // flagged if cut short
    const grade = avgScore >= 8 ? "Excellent" : avgScore >= 6 ? "Good" : avgScore >= 4 ? "Fair" : "Needs Practice";
    const gc    = avgScore >= 8 ? "#22c55e"   : avgScore >= 6 ? "#6366f1" : avgScore >= 4 ? "#f59e0b" : "#ef4444";
    const reset = (toPhase) => {
      setPhase(toPhase);
      if (toPhase === "intro") setName("");
      setDomain(null); setQuestion(null); setEval(null);
      setAnswer(""); setLive(""); setHistory([]); setResults([]); setQSlot(1); setUsedFollowUp(false);
    };
    return (
      <div style={{ minHeight: "100vh", background: "#050a14", color: "#e2e8f0", fontFamily: "system-ui,-apple-system,sans-serif", padding: "48px 20px" }}>
        <style>{CSS}</style>
        <div style={{ maxWidth: 620, margin: "0 auto" }}>
          <Logo />

          {/* Termination notice */}
          {terminated && (
            <div style={{
              background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: 12, padding: "14px 20px", marginBottom: 24,
              display: "flex", alignItems: "center", gap: 12,
            }}>
              <span style={{ fontSize: 22 }}>🚨</span>
              <div>
                <div style={{ fontWeight: 700, color: "#ef4444", fontSize: 14, marginBottom: 3 }}>
                  Interview Terminated — Proctoring Violation
                </div>
                <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
                  You looked away from the screen {MAX_WARNINGS} or more times. The interview was ended early and your score is based on {results.length} answered question{results.length !== 1 ? "s" : ""}.
                </div>
              </div>
            </div>
          )}

          <div style={{ textAlign: "center", margin: "16px 0 36px" }}>
            <div style={{ fontSize: 48, marginBottom: 10 }}>
              {terminated ? "🚫" : avgScore >= 7 ? "🎉" : avgScore >= 4 ? "👍" : "📖"}
            </div>
            <h2 style={{ fontSize: 24, fontWeight: 700, margin: "0 0 6px" }}>
              {terminated ? `Interview Ended, ${name}` : `Well done, ${name}!`}
            </h2>
            <p style={{ color: "#475569", marginBottom: 24 }}>
              {DOMAINS.find(d => d.id === domain)?.label} · {results.length} question{results.length !== 1 ? "s" : ""} answered
            </p>
            {results.length > 0 ? (
              <div style={{ display: "inline-flex", gap: 14, alignItems: "center", background: gc + "12", border: `1px solid ${gc}30`, borderRadius: 14, padding: "14px 28px" }}>
                <div style={{ fontSize: 36, fontWeight: 800, color: gc }}>{avgScore}</div>
                <div style={{ textAlign: "left" }}>
                  <div style={{ fontSize: 17, fontWeight: 700, color: gc }}>{grade}</div>
                  <div style={{ fontSize: 12, color: "#475569" }}>Average score</div>
                </div>
              </div>
            ) : (
              <div style={{ color: "#475569", fontSize: 15 }}>No questions were completed.</div>
            )}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 32 }}>
            {results.map((r, i) => (
              <div key={i} style={{ background: "#090f1e", border: "1px solid #1a2540", borderRadius: 12, padding: "14px 18px" }}>
                <div style={{ fontSize: 11, color: r.isFollowUp ? "#6366f1" : "#475569", marginBottom: 5, textTransform: "uppercase", letterSpacing: 1 }}>
                  {r.isFollowUp ? "Follow-up" : `Q${i + 1}`} · {r.topic}
                </div>
                <div style={{ fontSize: 14, color: "#64748b", marginBottom: 7, lineHeight: 1.5 }}>{r.question}</div>
                <div style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.55 }}>{r.feedback}</div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", gap: 10 }}>
            <Btn style={{ flex: 1 }} onClick={() => reset("setup")}>Try Again</Btn>
            <button style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid #1a2540", background: "transparent", color: "#64748b", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              onClick={() => reset("intro")}>New Session</button>
          </div>
        </div>
      </div>
    );
  }

  // ── INTERVIEW ─────────────────────────────────────────────────────────────
  const isFollowUpQ   = question?.topic === "Follow-up";
  const displayAnswer = answer + (liveTranscript ? (answer ? " " : "") + liveTranscript : "");
  const canToggleMic  = !aiSpeaking && !loading && !evaluation;

  return (
    <div style={{ minHeight: "100vh", background: "#050a14", color: "#e2e8f0", fontFamily: "system-ui,-apple-system,sans-serif", display: "flex", flexDirection: "column" }}>
      <style>{CSS}</style>

      <ProctorOverlay active={proctorActive} onTerminate={handleProctorTerminate} />

      <div style={{ height: 52, padding: "0 28px", borderBottom: "1px solid #0c1526", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={T.dot} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#64748b" }}>InterviewAI</span>
          <span style={{ color: "#0c1526", margin: "0 4px" }}>·</span>
          <span style={{ fontSize: 13, color: "#3d5070" }}>{name}</span>
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          {Array.from({ length: TOTAL_QUESTIONS }).map((_, i) => (
            <div key={i} style={{
              width: 28, height: 4, borderRadius: 2, transition: "background 0.3s",
              background: i < results.length ? "#6366f1" : i === qSlot - 1 ? "#6366f128" : "#0c1526",
            }} />
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "28px 20px", gap: 14 }}>
        <div style={{ width: "100%", maxWidth: 660, background: "#090f1e", border: "1px solid #0c1526", borderRadius: 20, padding: "26px 32px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 18 }}>
            <div style={{
              width: 40, height: 40, borderRadius: "50%", flexShrink: 0, fontSize: 13, fontWeight: 700,
              background: "linear-gradient(135deg,#6366f1,#8b5cf6)", color: "#fff",
              display: "flex", alignItems: "center", justifyContent: "center",
              boxShadow: aiSpeaking ? "0 0 22px #6366f155" : "none", transition: "box-shadow 0.3s",
            }}>AI</div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#c4cfe0" }}>AI Interviewer</div>
              <div style={{ fontSize: 12, color: aiSpeaking ? "#6366f1" : loading ? "#f59e0b" : "#2a3a5c" }}>
                {loading ? "thinking..." : aiSpeaking ? "speaking..." : micOn ? "listening to you" : "—"}
              </div>
            </div>
            {isFollowUpQ && (
              <div style={{ marginLeft: 8, fontSize: 11, color: "#6366f1", background: "#6366f112", borderRadius: 6, padding: "3px 9px", border: "1px solid #6366f128" }}>
                follow-up
              </div>
            )}
            <div style={{ marginLeft: "auto" }}><Waveform active={aiSpeaking} color="#6366f1" /></div>
          </div>
          {loading && !question ? (
            <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
              <span className="da" /><span className="db" /><span className="dc" />
              <span style={{ color: "#2a3a5c", fontSize: 15, marginLeft: 6 }}>Preparing question...</span>
            </div>
          ) : (
            <p style={{ fontSize: 19, lineHeight: 1.78, color: "#dde4f0", margin: 0, fontWeight: 400 }}>{question?.question}</p>
          )}
        </div>

        <div style={{ width: "100%", maxWidth: 660, background: "#090f1e", border: `1px solid ${micOn ? "#6366f122" : "#0c1526"}`, borderRadius: 20, padding: "20px 32px", transition: "border-color 0.2s" }}>
          {!evaluation ? (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 14 }}>
                <button onClick={canToggleMic ? toggleMic : undefined} disabled={!canToggleMic}
                  style={{
                    width: 44, height: 44, borderRadius: "50%", flexShrink: 0,
                    background: micOn ? (userTalking ? "#22c55e10" : "#6366f110") : "#0c1526",
                    border: `2px solid ${micOn ? (userTalking ? "#22c55e" : "#6366f1") : "#1a2540"}`,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 16, position: "relative", transition: "all 0.25s",
                    cursor: canToggleMic ? "pointer" : "default", outline: "none",
                  }}>
                  {micOn && <div className="pring" style={{ borderColor: userTalking ? "#22c55e" : "#6366f1" }} />}
                  {loading || aiSpeaking ? "⏳" : micOn ? (userTalking ? "🗣" : "👂") : "🎤"}
                </button>
                <div style={{ flex: 1 }}>
                  {aiSpeaking ? <div style={{ fontSize: 13, color: "#2a3a5c" }}>AI is speaking — mic opens after...</div>
                    : micOn ? (
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 500, color: userTalking ? "#22c55e" : "#6366f1" }}>
                          {userTalking ? "Capturing speech..." : "Listening — speak clearly"}
                        </div>
                        {silenceSec !== null && <div style={{ fontSize: 12, color: "#f59e0b", marginTop: 3 }}>Submitting in {silenceSec}s... keep talking to cancel</div>}
                      </div>
                    ) : loading ? <div style={{ fontSize: 13, color: "#2a3a5c" }}>Processing...</div>
                      : <div style={{ fontSize: 13, color: "#475569" }}>{canToggleMic ? "Click 🎤 to start mic, or type below" : "Mic opens automatically after the question"}</div>
                  }
                </div>
                <Waveform active={micOn && userTalking} color="#22c55e" bars={14} />
              </div>
              {displayAnswer && (
                <div style={{ background: "#060c18", border: "1px solid #1a2540", borderRadius: 10, padding: "12px 16px", fontSize: 15, color: "#94a3b8", lineHeight: 1.65, marginBottom: 12, minHeight: 52 }}>
                  {answer && <span style={{ color: "#c4d0e8" }}>{answer}</span>}
                  {liveTranscript && <span style={{ color: "#4a5a7a", fontStyle: "italic" }}>{answer ? " " : ""}{liveTranscript}</span>}
                </div>
              )}
              <textarea value={answer} onChange={e => setAnswer(e.target.value)}
                placeholder="Type your answer here, or use the mic above..."
                style={{ width: "100%", minHeight: 72, background: "transparent", border: "1px solid #1a2540", borderRadius: 10, padding: "10px 14px", color: "#64748b", fontSize: 14, fontFamily: "inherit", lineHeight: 1.6, resize: "none", outline: "none", boxSizing: "border-box" }} />
              {statusMsg && <div style={{ fontSize: 13, color: "#f59e0b", marginTop: 8 }}>{statusMsg}</div>}
            </>
          ) : (
            <div>
              <div style={{ fontSize: 11, color: "#2a3a5c", textTransform: "uppercase", letterSpacing: 1, fontWeight: 600, marginBottom: 10 }}>Feedback</div>
              <p style={{ fontSize: 15, color: "#94a3b8", lineHeight: 1.72, margin: 0 }}>{evaluation.feedback}</p>
            </div>
          )}
        </div>

        {!evaluation && !loading && !aiSpeaking && displayAnswer.trim() && (
          <Btn onClick={manualSubmit} style={{ minWidth: 200 }}>Submit Answer</Btn>
        )}
        {evaluation && (
          <Btn onClick={manualNext} style={{ minWidth: 200 }}>
            {qSlot >= TOTAL_QUESTIONS ? "See Results" : "Continue"}
          </Btn>
        )}
      </div>
    </div>
  );
}

function Shell({ children }) {
  return (
    <div style={{ minHeight: "100vh", background: "#050a14", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 20px", fontFamily: "system-ui,-apple-system,sans-serif", color: "#e2e8f0", textAlign: "center" }}>
      <style>{CSS}</style>
      <div style={{ maxWidth: 480, width: "100%" }}>{children}</div>
    </div>
  );
}
function Logo() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 32, justifyContent: "center" }}>
      <div style={T.dot} />
      <span style={{ fontSize: 14, fontWeight: 700, color: "#64748b", letterSpacing: 0.5 }}>InterviewAI</span>
    </div>
  );
}
function Btn({ children, onClick, disabled, style = {} }) {
  return (
    <button onClick={onClick} disabled={disabled} className="abtn"
      style={{ ...T.btn, opacity: disabled ? 0.38 : 1, cursor: disabled ? "not-allowed" : "pointer", ...style }}>
      {children}
    </button>
  );
}

const T = {
  h1:    { fontSize: "clamp(26px,5vw,42px)", fontWeight: 700, lineHeight: 1.2, marginBottom: 14, color: "#e2e8f0" },
  accent:{ color: "#6366f1" },
  sub:   { fontSize: 15, color: "#475569", lineHeight: 1.7 },
  input: { width: "100%", padding: "12px 16px", fontSize: 15, background: "#090f1e", border: "1px solid #1a2540", borderRadius: 10, color: "#e2e8f0", outline: "none", fontFamily: "inherit", boxSizing: "border-box" },
  btn:   { padding: "12px 28px", borderRadius: 10, border: "none", background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  dot:   { width: 8, height: 8, borderRadius: "50%", background: "#6366f1", flexShrink: 0 },
};

const CSS = `
  * { box-sizing: border-box; }
  body { margin: 0; background: #050a14; }
  textarea { resize: none; }
  textarea:focus { border-color: #6366f1 !important; outline: none; }
  input:focus  { border-color: #6366f1 !important; outline: none; }
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