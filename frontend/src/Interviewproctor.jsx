import { useState, useEffect, useRef, useCallback } from "react";

// Uses MediaPipe FaceMesh via CDN for reliable landmark-based detection.
// Landmark 10 = forehead, 1 = nose tip, 152 = chin.
// foreheadRatio = (nose.y - forehead.y) / faceHeight
//   Straight face: ~0.45-0.60
//   Looking down : < 0.30  (forehead exits frame / compresses)
// This is reliable regardless of skin tone or lighting.

const HOLD_MS = 3000;

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

export default function InterviewProctor({ onComplete }) {
  const videoRef = useRef(null);
  const holdRef  = useRef(0);
  const lastTRef = useRef(null);
  const mpCamRef = useRef(null);
  const doneRef  = useRef(false);

  const [screen,   setScreen]   = useState("welcome");
  const [camReady, setCamReady] = useState(false);
  const [mpReady,  setMpReady]  = useState(false);
  const [status,   setStatus]   = useState("noface"); // noface | lookdown | ok
  const [progress, setProgress] = useState(0);
  const [camError, setCamError] = useState("");

  const startMP = useCallback(async () => {
    try {
      await loadMediaPipe();

      const fm = new window.FaceMesh({
        locateFile: (f) => "https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/" + f,
      });
      fm.setOptions({
        maxNumFaces: 1,
        refineLandmarks: false,
        minDetectionConfidence: 0.5,
        minTrackingConfidence: 0.5,
      });

      fm.onResults((results) => {
        if (doneRef.current) return;
        const now = Date.now();
        const delta = lastTRef.current ? now - lastTRef.current : 16;
        lastTRef.current = now;

        let nextStatus = "noface";

        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
  const lm = results.multiFaceLandmarks[0];

  const forehead = lm[10];   // top of forehead
  const nose     = lm[1];    // nose tip
  const chin     = lm[152];  // chin
  const leftEye  = lm[159];  // left eye
  const rightEye = lm[386];  // right eye

  const faceH = chin.y - forehead.y;

  // Gate 1: face large enough — not just hair peeking in
  const faceIsLargeEnough = faceH > 0.15;

  // Gate 2: forehead must be inside frame (not cropped off top)
  // If forehead.y < 0.05 the head has tilted down out of frame
  const foreheadVisible = forehead.y > 0.05;

  // Gate 3: chin must be visible
  const chinVisible = chin.y < 0.92;

  // Gate 4: upright ratio — raised from 0.32 → 0.42 
  const ratio = faceH > 0 ? (nose.y - forehead.y) / faceH : 0;
  const headUpright = ratio > 0.42;

  // Gate 5: eye position relative to face height
  // Eyes should sit in the upper ~25–62% of the face band
  const eyeAvgY = (leftEye.y + rightEye.y) / 2;
  const eyeRelative = faceH > 0 ? (eyeAvgY - forehead.y) / faceH : 1;
  const eyesInRange = eyeRelative > 0.25 && eyeRelative < 0.62;

  if (faceIsLargeEnough && foreheadVisible && chinVisible && headUpright && eyesInRange) {
    nextStatus = "ok";
  } else if (faceH > 0.05) {
    nextStatus = "lookdown"; // something face-like but failing checks
  }
  // else remains "noface" (only hair or too small)
}

        setStatus(nextStatus);

        if (nextStatus === "ok") {
          holdRef.current = Math.min(HOLD_MS, holdRef.current + delta);
        } else {
          holdRef.current = Math.max(0, holdRef.current - delta * (nextStatus === "lookdown" ? 2.5 : 1.5));
        }

        const pct = Math.round((holdRef.current / HOLD_MS) * 100);
        setProgress(pct);

        if (holdRef.current >= HOLD_MS && !doneRef.current) {
          doneRef.current = true;
          if (mpCamRef.current) mpCamRef.current.stop();
          setTimeout(() => setScreen("done"), 400);
        }
      });

      const cam = new window.Camera(videoRef.current, {
        onFrame: async () => { await fm.send({ image: videoRef.current }); },
        width: 1280, height: 720,
      });
      mpCamRef.current = cam;
      await cam.start();
      setCamReady(true);
      setMpReady(true);
    } catch (e) {
      setCamError("Could not load face detection. Please check your internet connection and reload.");
    }
  }, []);

  useEffect(() => {
    return () => { if (mpCamRef.current) mpCamRef.current.stop(); };
  }, []);

  const handleBegin = () => { setScreen("setup"); startMP(); };

  // Ring
  const RX = 148, RY = 190;
  const CIRC = Math.PI * (3 * (RX + RY) - Math.sqrt((3 * RX + RY) * (RX + 3 * RY)));
  const ringColor =
    status === "ok" && progress > 0
      ? progress < 50 ? "#3b82f6" : progress < 85 ? "#34d399" : "#10b981"
      : "#1e3a5f";

  const pill = {
    noface:   { msg: !camReady ? "Starting camera..." : "Place your face inside the oval", color: "#93c5fd" },
    lookdown: { msg: "Look straight at the screen",                                         color: "#fbbf24" },
    ok:       { msg: progress >= 100 ? "Verified!" : "Perfect, hold still...",              color: "#34d399" },
  }[status] || { msg: "...", color: "#93c5fd" };

  return (
    <div style={S.root}>
      <style>{CSS}</style>

      {screen === "welcome" && (
        <div style={S.center}>
          <div style={S.card} className="anim-up">
            <Logo />
            <h1 style={S.h1}>Camera Verification</h1>
            <p style={S.desc}>
              Before your interview starts we verify your identity. Place your face in the oval
              and look straight at the screen — hold for 3 seconds.
            </p>
            <ul style={S.ul}>
              <li>Sit in a well-lit space facing a light source</li>
              <li>Keep your face centred and upright in the oval</li>
              <li>Hold completely still for 3 seconds</li>
            </ul>
            <button style={S.btn} className="hov" onClick={handleBegin}>
              Allow Camera and Continue
            </button>
          </div>
        </div>
      )}

      {screen === "setup" && (
        <div style={S.page}>
          <header style={S.header}>
            <Logo small />
            <div style={S.badge}><span style={S.pip} /> Proctor Connected</div>
          </header>

          <div style={S.layout}>
            {/* Left */}
            <div style={S.panel} className="anim-up">
              <h2 style={S.h2}>Position your face</h2>
              <p style={S.subdesc}>
                Look straight at the camera with your face upright and fully visible inside the oval.
                Hold still for 3 seconds to complete verification.
              </p>

              <div style={S.checks}>
                <Row label="Camera active"
                  state={camReady ? "ok" : "spin"} />
                <Row label="Face detected"
                  state={camReady && status !== "noface" ? "ok" : camReady ? "spin" : "idle"} />
                <Row label="Looking straight"
                  state={status === "ok" ? "ok" : status === "lookdown" ? "warn" : "idle"}
                  warnLabel="Look straight at screen" />
                <Row label="Hold steady 3s"
                  state={progress >= 100 ? "ok" : status === "ok" && progress > 0 ? "spin" : "idle"}
                  sub={status === "ok" && progress > 0 && progress < 100
                    ? (holdRef.current / 1000).toFixed(1) + "s / 3.0s" : null} />
              </div>

              <div style={{
                ...S.statusBox,
                color: pill.color,
                borderColor: pill.color + "44",
                background: pill.color + "12",
              }}>
                {!mpReady && !camError ? "Loading face detection..." : pill.msg}
              </div>

              {camError && <div style={S.errBox}>{camError}</div>}
            </div>

            {/* Camera */}
            <div style={S.camWrap} className="anim-up anim-delay">
              <div style={S.oval}>
                <video ref={videoRef} style={S.video} autoPlay muted playsInline />
                {camReady && status !== "ok" && <div style={S.veil} />}
              </div>

              <svg width={320} height={400} viewBox="0 0 320 400" style={S.svg}>
                {/* Guide */}
                <ellipse cx={160} cy={200} rx={RX} ry={RY}
                  fill="none" stroke="rgba(255,255,255,0.08)"
                  strokeWidth={1.5} strokeDasharray="5 4" />
                {/* Progress */}
                <ellipse cx={160} cy={200} rx={RX} ry={RY}
                  fill="none"
                  stroke={ringColor}
                  strokeWidth={3.5}
                  strokeLinecap="round"
                  strokeDasharray={CIRC}
                  strokeDashoffset={CIRC * (1 - progress / 100)}
                  transform="rotate(-90 160 200)"
                  style={{ transition: "stroke-dashoffset 0.15s linear, stroke 0.4s" }}
                />
                {[0, 25, 50, 75].map((p) => {
                  const a = (p / 100) * 2 * Math.PI - Math.PI / 2;
                  return (
                    <line key={p}
                      x1={160 + RX * Math.cos(a)} y1={200 + RY * Math.sin(a)}
                      x2={160 + (RX - 9) * Math.cos(a)} y2={200 + (RY - 9) * Math.sin(a)}
                      stroke="rgba(255,255,255,0.1)" strokeWidth={1.5} />
                  );
                })}
                {progress > 3 && progress < 100 && (
                  <text x={160} y={395} textAnchor="middle"
                    fill={ringColor} fontSize={11} fontFamily="monospace" fontWeight="bold">
                    {progress}%
                  </text>
                )}
              </svg>

              {/* Corner brackets */}
              {[
                { top: 4,    left:  32, borderTop: "2px solid #0f2040", borderLeft:  "2px solid #0f2040" },
                { top: 4,    right: 32, borderTop: "2px solid #0f2040", borderRight: "2px solid #0f2040" },
                { bottom: 4, left:  32, borderBottom: "2px solid #0f2040", borderLeft:  "2px solid #0f2040" },
                { bottom: 4, right: 32, borderBottom: "2px solid #0f2040", borderRight: "2px solid #0f2040" },
              ].map((st, i) => <div key={i} style={{ position: "absolute", width: 20, height: 20, ...st }} />)}
            </div>
          </div>
        </div>
      )}

      {screen === "done" && (
        <div style={S.center}>
          <div style={{ ...S.card, alignItems: "center", textAlign: "center" }} className="anim-up">
            <div style={S.doneCircle}>
              <svg width={110} height={110} viewBox="0 0 110 110">
                <circle cx={55} cy={55} r={50} fill="none"
                  stroke="#10b981" strokeWidth={2.5} className="ring-draw" />
              </svg>
              <span style={{ position: "absolute", fontSize: "2rem", color: "#10b981" }}>✓</span>
            </div>
            <h1 style={{ ...S.h1, color: "#10b981" }}>Identity Verified</h1>
            <p style={S.desc}>You are cleared to proceed. Your interview environment is ready.</p>
            <button
              style={{ ...S.btn, background: "#10b981", boxShadow: "0 4px 24px rgba(16,185,129,0.3)" }}
              className="hov"
              onClick={() => onComplete ? onComplete() : alert("Starting interview...")}>
              Start Interview
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Logo({ small }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{
        display: "inline-block",
        width: small ? 7 : 10, height: small ? 7 : 10,
        borderRadius: "50%", background: "#3b82f6",
        boxShadow: "0 0 10px #3b82f6", animation: "blink 2s infinite",
      }} />
      <span style={{ fontWeight: 800, fontSize: small ? "0.82rem" : "0.95rem", color: "#60a5fa" }}>
        InterviewAI
      </span>
    </div>
  );
}

function Row({ label, state, warnLabel, sub }) {
  // state: idle | spin | ok | warn
  const C = {
    idle: { color: "#1e293b", bg: "rgba(255,255,255,0.02)", border: "rgba(255,255,255,0.04)", dot: null },
    spin: { color: "#3b82f6", bg: "rgba(59,130,246,0.06)",  border: "rgba(59,130,246,0.14)",  dot: "spin" },
    ok:   { color: "#10b981", bg: "rgba(16,185,129,0.07)",  border: "rgba(16,185,129,0.22)",  dot: "check" },
    warn: { color: "#fbbf24", bg: "rgba(251,191,36,0.07)",  border: "rgba(251,191,36,0.20)",  dot: "warn" },
  }[state] || {};

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      padding: "11px 14px", borderRadius: 8,
      background: C.bg, border: "1px solid " + C.border,
      transition: "all 0.35s",
    }}>
      <div style={{
        width: 20, height: 20, borderRadius: "50%", flexShrink: 0,
        background: C.dot === "check" ? "#10b981" : C.dot === "warn" ? "#fbbf24" : "transparent",
        border: "2px solid " + C.color,
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "0.6rem", color: "white", transition: "all 0.3s",
      }}>
        {C.dot === "check" && "✓"}
        {C.dot === "warn"  && "!"}
        {C.dot === "spin"  && <span className="spin-dot" />}
      </div>
      <div>
        <div style={{ fontSize: "0.83rem", fontWeight: 600, color: C.color, transition: "color 0.3s" }}>
          {state === "warn" && warnLabel ? warnLabel : label}
        </div>
        {sub && <div style={{ fontSize: "0.72rem", color: "#475569", marginTop: 1 }}>{sub}</div>}
      </div>
    </div>
  );
}

const CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @keyframes anim-up  { from { opacity:0; transform:translateY(16px) } to { opacity:1; transform:none } }
  @keyframes blink     { 0%,100%{opacity:1} 50%{opacity:0.25} }
  @keyframes spin-dot  { to { transform: rotate(360deg) } }
  @keyframes ring-draw { from{stroke-dashoffset:314} to{stroke-dashoffset:0} }
  .anim-up    { animation: anim-up 0.45s ease both; }
  .anim-delay { animation-delay: 0.07s; }
  .hov        { transition: all 0.2s; cursor: pointer; }
  .hov:hover  { filter: brightness(1.1); transform: translateY(-2px); }
  .spin-dot   {
    display: block; width: 7px; height: 7px; border-radius: 50%;
    border: 2px solid currentColor; border-top-color: transparent;
    animation: spin-dot 0.7s linear infinite;
  }
  .ring-draw  { stroke-dasharray: 314; animation: ring-draw 0.85s ease forwards; }
`;

const S = {
  root:      { fontFamily: "'Plus Jakarta Sans',sans-serif", background: "#050b14", color: "#e2e8f0", minHeight: "100vh", display: "flex", flexDirection: "column" },
  center:    { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", padding: 24 },
  card:      { background: "#0a1628", border: "1px solid #122040", borderRadius: 20, padding: "44px 40px", maxWidth: 460, width: "100%", display: "flex", flexDirection: "column", gap: 18, boxShadow: "0 30px 70px rgba(0,0,0,0.55)" },
  h1:        { fontSize: "1.8rem", fontWeight: 800, letterSpacing: "-0.025em", color: "#f1f5f9", lineHeight: 1.2 },
  h2:        { fontSize: "1.4rem", fontWeight: 800, letterSpacing: "-0.02em",  color: "#f1f5f9", lineHeight: 1.2 },
  desc:      { color: "#4b6080", fontSize: "0.9rem", lineHeight: 1.7 },
  subdesc:   { color: "#374e6a", fontSize: "0.86rem", lineHeight: 1.65, marginTop: -4 },
  ul:        { color: "#4b6080", fontSize: "0.88rem", lineHeight: 1.8, paddingLeft: 20 },
  btn:       { background: "#2563eb", color: "white", border: "none", padding: "14px 24px", borderRadius: 10, fontWeight: 700, fontSize: "0.92rem", fontFamily: "inherit", cursor: "pointer", boxShadow: "0 4px 20px rgba(37,99,235,0.3)", marginTop: 4 },
  page:      { flex: 1, display: "flex", flexDirection: "column" },
  header:    { height: 52, background: "#060d1a", borderBottom: "1px solid #0d1f33", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 28px", flexShrink: 0 },
  badge:     { fontSize: "0.72rem", fontWeight: 600, color: "#10b981", background: "rgba(16,185,129,0.07)", border: "1px solid rgba(16,185,129,0.18)", padding: "5px 12px", borderRadius: 20, display: "flex", alignItems: "center", gap: 6 },
  pip:       { display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#10b981", animation: "blink 1.4s infinite" },
  layout:    { flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 56, padding: "32px 48px" },
  panel:     { maxWidth: 290, display: "flex", flexDirection: "column", gap: 16 },
  checks:    { display: "flex", flexDirection: "column", gap: 8 },
  statusBox: { marginTop: 2, padding: "10px 16px", borderRadius: 8, fontSize: "0.83rem", fontWeight: 600, textAlign: "center", border: "1px solid", transition: "all 0.3s" },
  errBox:    { background: "rgba(239,68,68,0.07)", border: "1px solid rgba(239,68,68,0.2)", color: "#f87171", padding: "10px 14px", borderRadius: 8, fontSize: "0.82rem", lineHeight: 1.5 },
  camWrap:   { position: "relative", width: 320, height: 400, flexShrink: 0 },
  oval:      { position: "absolute", inset: 0, overflow: "hidden", clipPath: "ellipse(148px 190px at 50% 50%)", background: "#060d1a" },
  video:     { width: "100%", height: "100%", objectFit: "cover", transform: "scaleX(-1)" },
  veil:      { position: "absolute", inset: 0, background: "rgba(5,11,20,0.42)" },
  svg:       { position: "absolute", inset: 0, pointerEvents: "none" },
  doneCircle: { position: "relative", width: 110, height: 110, display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto" },
};


//delta