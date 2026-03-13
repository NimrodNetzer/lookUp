"use client";

import { useState } from "react";

const GATEWAY = "http://127.0.0.1:18789";

export default function ExtensionScreen({ onDone }: { onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const [folderOpened, setFolderOpened] = useState(false);
  const [folderPath, setFolderPath] = useState("");

  async function handleOpenFolder() {
    try {
      const r = await fetch(`${GATEWAY}/setup/extension-path`);
      const j = await r.json();
      setFolderPath(j.path ?? "");
      setFolderOpened(true);
    } catch {
      setFolderOpened(true);
    }
  }

  function handleCopy() {
    navigator.clipboard.writeText("chrome://extensions");
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 50,
      display: "flex", alignItems: "center", justifyContent: "center",
      padding: "24px",
    }}>
      <div style={{
        width: "100%", maxWidth: "520px",
        background: "rgba(14,12,28,0.92)",
        border: "1px solid rgba(124,106,245,0.25)",
        borderRadius: "20px",
        padding: "40px 36px",
        backdropFilter: "blur(20px)",
        boxShadow: "0 0 60px rgba(100,80,230,0.15), 0 0 0 1px rgba(124,106,245,0.1)",
      }}>

        {/* Header */}
        <div style={{ textAlign: "center", marginBottom: "28px" }}>
          <div style={{
            fontSize: "32px", fontWeight: 800, letterSpacing: "-0.5px",
            background: "linear-gradient(130deg, #9d8cff 0%, #7c6af5 50%, #5eead4 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            marginBottom: "6px",
          }}>Almost there!</div>
          <div style={{ color: "#888", fontSize: "14px" }}>Install the Chrome Extension — 3 quick steps</div>
        </div>

        <div style={{ height: "1px", background: "rgba(124,106,245,0.15)", marginBottom: "28px" }} />

        {/* Step 1 */}
        <div style={{ marginBottom: "20px" }}>
          <StepLabel n={1} text="Open Chrome Extensions" />
          <p style={{ color: "#aaa", fontSize: "13px", margin: "8px 0 10px 32px", lineHeight: 1.6 }}>
            In Chrome, type this in the address bar and press Enter:
          </p>
          <div style={{ marginLeft: "32px", display: "flex", alignItems: "center", gap: "8px" }}>
            <code style={{
              flex: 1,
              background: "rgba(124,106,245,0.12)",
              border: "1px solid rgba(124,106,245,0.25)",
              borderRadius: "8px", padding: "8px 12px",
              color: "#9d8cff", fontSize: "13px", fontFamily: "monospace",
            }}>chrome://extensions</code>
            <button
              onClick={handleCopy}
              style={{
                background: copied ? "rgba(94,234,212,0.15)" : "rgba(124,106,245,0.15)",
                border: `1px solid ${copied ? "rgba(94,234,212,0.4)" : "rgba(124,106,245,0.35)"}`,
                borderRadius: "8px", padding: "8px 14px",
                color: copied ? "#5eead4" : "#c0b8ff", fontSize: "12px", fontWeight: 600,
                cursor: "pointer", whiteSpace: "nowrap",
                transition: "all 0.2s",
              }}
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>

        {/* Step 2 */}
        <div style={{ marginBottom: "20px" }}>
          <StepLabel n={2} text='Enable "Developer mode"' />
          <p style={{ color: "#aaa", fontSize: "13px", margin: "8px 0 0 32px", lineHeight: 1.6 }}>
            On the Extensions page, toggle <strong style={{ color: "#d0d0e8" }}>Developer mode</strong> on
            — it's in the <strong style={{ color: "#d0d0e8" }}>top-right corner</strong> of the page.
          </p>
        </div>

        {/* Step 3 */}
        <div style={{ marginBottom: "28px" }}>
          <StepLabel n={3} text='Click "Load unpacked" and select the folder' />
          <p style={{ color: "#aaa", fontSize: "13px", margin: "8px 0 10px 32px", lineHeight: 1.6 }}>
            A <strong style={{ color: "#d0d0e8" }}>Load unpacked</strong> button appears after enabling Developer mode.
            Click it, then select the extension folder — use the button below to open it automatically.
          </p>
          <div style={{ marginLeft: "32px" }}>
            <button
              onClick={handleOpenFolder}
              style={{
                display: "inline-flex", alignItems: "center", gap: "8px",
                background: folderOpened
                  ? "rgba(94,234,212,0.1)"
                  : "linear-gradient(135deg, rgba(124,106,245,0.2), rgba(94,234,212,0.1))",
                border: `1px solid ${folderOpened ? "rgba(94,234,212,0.4)" : "rgba(124,106,245,0.4)"}`,
                borderRadius: "10px", padding: "9px 18px",
                color: folderOpened ? "#5eead4" : "#c0b8ff",
                fontSize: "13px", fontWeight: 600,
                cursor: "pointer", transition: "all 0.2s",
              }}
            >
              <span>📂</span>
              {folderOpened ? "Folder opened ✓" : "Open Extension Folder"}
            </button>
            {folderPath && (
              <p style={{ color: "#555", fontSize: "11px", marginTop: "6px", fontFamily: "monospace" }}>
                {folderPath}
              </p>
            )}
          </div>
        </div>

        {/* Done button */}
        <button
          onClick={onDone}
          style={{
            width: "100%", padding: "13px",
            background: "linear-gradient(135deg, #7c6af5, #5eead4)",
            border: "none", borderRadius: "12px",
            color: "#fff", fontSize: "15px", fontWeight: 700,
            cursor: "pointer",
          }}
        >
          Done — Open LookUp Dashboard →
        </button>

        <p style={{ color: "#555", fontSize: "11px", textAlign: "center", marginTop: "14px" }}>
          You only need to do this once. The extension stays installed in Chrome.
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
