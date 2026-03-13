"use client";

import { useState } from "react";

const GATEWAY = "http://127.0.0.1:18789";
const GROQ_KEYS_URL = "https://console.groq.com/keys";

export default function SetupScreen({ onDone }: { onDone: () => void }) {
  const [key, setKey] = useState("");
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleSave() {
    const trimmed = key.trim();
    if (!trimmed) { setErrorMsg("Please paste your API key first."); return; }
    if (!trimmed.startsWith("gsk_")) {
      setErrorMsg("That doesn't look like a Groq key — it should start with gsk_");
      return;
    }
    setStatus("loading");
    setErrorMsg("");
    try {
      const r = await fetch(`${GATEWAY}/setup/apikey`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: trimmed }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error ?? "Failed to save key");
      }
      onDone();
    } catch (e: unknown) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : "Something went wrong");
    }
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px",
    }}>
      {/* Card */}
      <div style={{
        width: "100%", maxWidth: "480px",
        background: "rgba(14,12,28,0.92)",
        border: "1px solid rgba(124,106,245,0.25)",
        borderRadius: "20px",
        padding: "40px 36px",
        backdropFilter: "blur(20px)",
        boxShadow: "0 0 60px rgba(100,80,230,0.15), 0 0 0 1px rgba(124,106,245,0.1)",
      }}>

        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div style={{
            fontSize: "32px", fontWeight: 800, letterSpacing: "-0.5px",
            background: "linear-gradient(130deg, #9d8cff 0%, #7c6af5 50%, #5eead4 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            marginBottom: "6px",
          }}>LookUp</div>
          <div style={{ color: "#888", fontSize: "14px" }}>Study Sensei — First-time Setup</div>
        </div>

        {/* Divider */}
        <div style={{ height: "1px", background: "rgba(124,106,245,0.15)", marginBottom: "28px" }} />

        {/* Step 1 */}
        <div style={{ marginBottom: "20px" }}>
          <StepLabel n={1} text="Get a free Groq API key" />
          <p style={{ color: "#aaa", fontSize: "13px", lineHeight: 1.6, margin: "8px 0 12px" }}>
            LookUp uses Groq's AI — it's free. Click below to open the Groq Console,
            sign up (or log in), and create a new API key.
          </p>
          <a
            href={GROQ_KEYS_URL}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex", alignItems: "center", gap: "8px",
              background: "linear-gradient(135deg, rgba(124,106,245,0.2), rgba(94,234,212,0.1))",
              border: "1px solid rgba(124,106,245,0.4)",
              borderRadius: "10px", padding: "9px 18px",
              color: "#c0b8ff", fontSize: "13px", fontWeight: 600,
              textDecoration: "none",
              transition: "border-color 0.2s, background 0.2s",
            }}
            onMouseEnter={e => (e.currentTarget.style.borderColor = "rgba(124,106,245,0.8)")}
            onMouseLeave={e => (e.currentTarget.style.borderColor = "rgba(124,106,245,0.4)")}
          >
            <span>🔑</span> Open Groq Console → Create API Key
            <span style={{ color: "#666", fontSize: "11px" }}>↗</span>
          </a>
        </div>

        {/* Step 2 */}
        <div style={{ marginBottom: "24px" }}>
          <StepLabel n={2} text="Paste your key here" />
          <p style={{ color: "#aaa", fontSize: "13px", margin: "8px 0 10px" }}>
            Copy the key from Groq (starts with <code style={{
              background: "rgba(124,106,245,0.15)", borderRadius: "4px",
              padding: "1px 6px", fontSize: "12px", color: "#9d8cff"
            }}>gsk_…</code>) and paste it below.
          </p>

          {/* Input row */}
          <div style={{ position: "relative" }}>
            <input
              type={show ? "text" : "password"}
              value={key}
              onChange={e => { setKey(e.target.value); setErrorMsg(""); }}
              onKeyDown={e => e.key === "Enter" && handleSave()}
              placeholder="gsk_••••••••••••••••••••••••"
              spellCheck={false}
              autoComplete="off"
              style={{
                width: "100%", boxSizing: "border-box",
                background: "rgba(255,255,255,0.04)",
                border: `1px solid ${errorMsg ? "rgba(240,80,80,0.5)" : "rgba(124,106,245,0.25)"}`,
                borderRadius: "10px", padding: "11px 44px 11px 14px",
                color: "#e8e8f0", fontSize: "13px", fontFamily: "monospace",
                outline: "none",
                transition: "border-color 0.2s",
              }}
              onFocus={e => (e.target.style.borderColor = "rgba(124,106,245,0.6)")}
              onBlur={e => (e.target.style.borderColor = errorMsg ? "rgba(240,80,80,0.5)" : "rgba(124,106,245,0.25)")}
            />
            {/* Toggle visibility */}
            <button
              onClick={() => setShow(v => !v)}
              style={{
                position: "absolute", right: "12px", top: "50%", transform: "translateY(-50%)",
                background: "none", border: "none", cursor: "pointer",
                color: "#555", fontSize: "14px", padding: "2px",
              }}
              title={show ? "Hide key" : "Show key"}
            >
              {show ? "🙈" : "👁️"}
            </button>
          </div>

          {/* Error message */}
          {errorMsg && (
            <p style={{ color: "#f05050", fontSize: "12px", marginTop: "7px" }}>⚠ {errorMsg}</p>
          )}
        </div>

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={status === "loading"}
          style={{
            width: "100%", padding: "13px",
            background: status === "loading"
              ? "rgba(124,106,245,0.3)"
              : "linear-gradient(135deg, #7c6af5, #5eead4)",
            border: "none", borderRadius: "12px",
            color: "#fff", fontSize: "15px", fontWeight: 700,
            cursor: status === "loading" ? "not-allowed" : "pointer",
            transition: "opacity 0.2s",
            opacity: status === "loading" ? 0.7 : 1,
          }}
        >
          {status === "loading" ? "Saving…" : "Save & Start LookUp ✓"}
        </button>

        <p style={{ color: "#555", fontSize: "11px", textAlign: "center", marginTop: "16px" }}>
          Your key is stored locally on your computer only — never uploaded anywhere.
        </p>
      </div>
    </div>
  );
}

function StepLabel({ n, text }: { n: number; text: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
      <div style={{
        width: "22px", height: "22px", borderRadius: "50%", flexShrink: 0,
        background: "linear-gradient(135deg, #7c6af5, #5eead4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "11px", fontWeight: 800, color: "#fff",
      }}>{n}</div>
      <span style={{ color: "#d0d0e8", fontSize: "14px", fontWeight: 600 }}>{text}</span>
    </div>
  );
}
