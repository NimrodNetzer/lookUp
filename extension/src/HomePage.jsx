import { useEffect, useState } from "react";
import LearningHub from "./LearningHub.jsx";
import GlobalSearch from "./GlobalSearch.jsx";

const DAILY_LIMIT = 500_000;
const AVG_TOKENS_PER_CAPTURE = 2200;

function getResetMs() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight - now;
}

function formatReset(ms) {
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function TokenUsageBar() {
  const [tokens, setTokens] = useState(0);
  const [resetIn, setResetIn] = useState(getResetMs());

  useEffect(() => {
    function load() {
      chrome.storage.local.get("tokenUsage", ({ tokenUsage }) => {
        if (!tokenUsage) return;
        const today = new Date().toDateString();
        setTokens(tokenUsage.date === today ? (tokenUsage.tokens ?? 0) : 0);
      });
    }
    load();

    // refresh when storage changes (e.g. sidepanel made a capture)
    const handler = (changes) => { if (changes.tokenUsage) load(); };
    chrome.storage.onChanged.addListener(handler);

    // tick countdown every minute
    const tick = setInterval(() => setResetIn(getResetMs()), 60_000);

    return () => {
      chrome.storage.onChanged.removeListener(handler);
      clearInterval(tick);
    };
  }, []);

  const pct = Math.min(tokens / DAILY_LIMIT, 1);
  const used = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens;
  const remaining = Math.max(0, DAILY_LIMIT - tokens);
  const captures = Math.floor(remaining / AVG_TOKENS_PER_CAPTURE);
  const warn = pct >= 0.9;
  const mid  = pct >= 0.7;
  const barColor = warn ? "#ef4444" : mid ? "#f59e0b" : "#7c6af5";

  return (
    <div className="bg-surface border border-border rounded-2xl px-4 py-3 mb-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-text">Daily AI usage</span>
        <span className="text-xs text-muted">Resets in {formatReset(resetIn)}</span>
      </div>

      {/* progress bar */}
      <div className="h-1.5 w-full bg-bg rounded-full overflow-hidden mb-2">
        <div
          className="h-full rounded-full transition-all duration-500"
          style={{ width: `${pct * 100}%`, background: barColor }}
        />
      </div>

      <div className="flex items-end justify-between">
        <div>
          <span className="text-sm font-bold text-text">{used}</span>
          <span className="text-xs text-muted"> / 500k tokens used today</span>
        </div>
        <div className="text-right">
          <span className="text-sm font-bold" style={{ color: barColor }}>~{captures}</span>
          <span className="text-xs text-muted"> captures left</span>
        </div>
      </div>

      {warn && (
        <p className="text-xs text-red-400 mt-2">
          Almost out — resets in {formatReset(resetIn)}.
        </p>
      )}

      <p className="text-xs text-muted mt-1 leading-relaxed">
        Powered by <span className="text-text font-medium">Groq's free tier</span> — 500k tokens/day.
        Each capture costs ~{AVG_TOKENS_PER_CAPTURE.toLocaleString()} tokens on average.
      </p>
    </div>
  );
}

export default function HomePage({ onOpenNote }) {
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  function openChat() {
    window.open(chrome.runtime.getURL("built/chat.html"), "_blank");
  }

  return (
    <div className="max-w-5xl mx-auto px-5 py-8">
      <header className="mb-8 flex items-center gap-4">
        <div>
          <h1 className="text-3xl font-extrabold bg-gradient-to-r from-accent to-teal bg-clip-text text-transparent">
            LookUp
          </h1>
          <p className="text-muted text-sm mt-1">Your personal learning hub</p>
        </div>
        <div className="ml-auto">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-xl text-sm text-muted hover:text-text hover:border-accent/40 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
            </svg>
            Search notes
            <span className="text-xs border border-border rounded px-1 py-0.5 font-mono opacity-60">⌘K</span>
          </button>
        </div>
      </header>

      {searchOpen && (
        <GlobalSearch
          onClose={() => setSearchOpen(false)}
          onOpenNote={(filename) => { setSearchOpen(false); onOpenNote(filename); }}
        />
      )}

      <TokenUsageBar />
      <LearningHub onOpenNote={onOpenNote} onOpenChat={openChat} />
    </div>
  );
}
