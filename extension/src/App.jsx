import React, { useState, useEffect } from "react";
import { Settings } from "../storage.js";
import { verifyApiKey } from "../groq-client.js";
import HomePage from "./HomePage.jsx";
import NoteViewer from "./NoteViewer.jsx";
import CosmicBg from "./CosmicBg.jsx";

export default function App() {
  const [page, setPage] = useState("home"); // "home" | "note"
  const [activeNote, setActiveNote] = useState(null); // filename string
  const [configured, setConfigured] = useState(null); // null = loading

  useEffect(() => {
    Settings.isConfigured().then(setConfigured);
  }, []);

  function openNote(filename) {
    setActiveNote(filename);
    setPage("note");
  }

  function goHome() {
    setPage("home");
    setActiveNote(null);
  }

  if (configured === null) {
    return (
      <div className="min-h-screen bg-bg flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!configured) {
    return <SetupScreen onDone={() => setConfigured(true)} />;
  }

  return (
    <div className="min-h-screen bg-bg text-text relative overflow-hidden">
      <CosmicBg variant="default" />
      <div className="relative z-10">
        {page === "home" && <HomePage onOpenNote={openNote} />}
        {page === "note" && (
          <NoteViewer filename={activeNote} onBack={goHome} />
        )}
      </div>
    </div>
  );
}

function SetupScreen({ onDone }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSave() {
    if (!key.trim()) return;
    setLoading(true);
    setError("");
    try {
      const ok = await verifyApiKey(key.trim());
      if (!ok) throw new Error("Key verification failed");
      await Settings.setApiKey(key.trim());
      onDone();
    } catch {
      setError("Invalid API key. Please check and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg flex items-center justify-center p-6">
      <CosmicBg variant="dark" />
      <div className="relative z-10 w-full max-w-md bg-surface border border-border rounded-2xl p-8 shadow-2xl">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🔭</div>
          <h1 className="text-2xl font-bold text-text mb-1">Welcome to LookUp</h1>
          <p className="text-muted text-sm">Your AI study assistant. Free to use — just bring your Groq key.</p>
        </div>

        <div className="space-y-6">
          <div>
            <p className="text-sm font-medium text-text mb-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white text-xs mr-2">1</span>
              Get your free API key
            </p>
            <a
              href="https://console.groq.com/keys"
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-2 px-4 py-3 bg-accent/10 border border-accent/30 rounded-lg text-accent text-sm hover:bg-accent/20 transition-colors"
            >
              Open console.groq.com/keys →
            </a>
          </div>

          <div>
            <p className="text-sm font-medium text-text mb-2">
              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-accent text-white text-xs mr-2">2</span>
              Paste your API key below
            </p>
            <input
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="gsk_..."
              className="w-full px-4 py-3 bg-bg border border-border rounded-lg text-text placeholder-muted text-sm focus:outline-none focus:border-accent transition-colors"
            />
            {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          </div>

          <button
            onClick={handleSave}
            disabled={loading || !key.trim()}
            className="w-full py-3 bg-accent hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors"
          >
            {loading ? "Verifying…" : "Save & Start Learning"}
          </button>
        </div>
      </div>
    </div>
  );
}
