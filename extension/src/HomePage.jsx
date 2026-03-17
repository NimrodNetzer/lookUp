import { useEffect, useState, useRef, useCallback } from "react";
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

function useTokenUsage() {
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
    const handler = (changes) => { if (changes.tokenUsage) load(); };
    chrome.storage.onChanged.addListener(handler);
    const tick = setInterval(() => setResetIn(getResetMs()), 60_000);
    return () => { chrome.storage.onChanged.removeListener(handler); clearInterval(tick); };
  }, []);
  return { tokens, resetIn };
}

function ActionsDropdown({ onSearch, hubActionsRef }) {
  const [open, setOpen]     = useState(false);
  const [showTokens, setShowTokens] = useState(false);
  const ref = useRef(null);
  const { tokens, resetIn } = useTokenUsage();

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pct = Math.min(tokens / DAILY_LIMIT, 1);
  const used = tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : String(tokens);
  const remaining = Math.max(0, DAILY_LIMIT - tokens);
  const captures = Math.floor(remaining / AVG_TOKENS_PER_CAPTURE);
  const warn = pct >= 0.9;
  const mid  = pct >= 0.7;
  const barColor = warn ? "#ef4444" : mid ? "#f59e0b" : "#7c6af5";

  function close() { setOpen(false); setShowTokens(false); }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 px-3 py-2 bg-surface border border-border rounded-xl text-sm text-muted hover:text-text hover:border-accent/40 transition-colors"
        title="Actions"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/>
          <line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
        </svg>
        Menu
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-surface border border-border rounded-2xl shadow-2xl overflow-hidden w-56">
          <div className="py-1">
            <button
              onClick={() => { onSearch(); close(); }}
              className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-accent/10 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              Search notes
              <span className="ml-auto text-[10px] border border-border rounded px-1 py-0.5 font-mono text-muted opacity-70">⌘K</span>
            </button>
            <button
              onClick={() => { hubActionsRef.current?.openNewNote(); close(); }}
              className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-accent/10 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><polyline points="14 2 14 8 20 8"/><line x1="12" y1="18" x2="12" y2="12"/><line x1="9" y1="15" x2="15" y2="15"/></svg>
              New note
            </button>
            <button
              onClick={() => { hubActionsRef.current?.openNewFolder(); close(); }}
              className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-text hover:bg-accent/10 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><line x1="9" y1="14" x2="15" y2="14"/></svg>
              New folder
            </button>
          </div>

          <div className="border-t border-border">
            <button
              onClick={() => setShowTokens((v) => !v)}
              className="w-full text-left flex items-center gap-3 px-4 py-2.5 text-sm text-muted hover:text-text hover:bg-accent/10 transition-colors"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>
              AI usage today
              <span className="ml-auto text-[10px] font-semibold" style={{ color: barColor }}>{used}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className={showTokens ? "rotate-180 transition-transform" : "transition-transform"}><polyline points="6 9 12 15 18 9"/></svg>
            </button>

            {showTokens && (
              <div className="px-4 pb-3 bg-bg/40">
                <div className="h-1.5 w-full bg-bg rounded-full overflow-hidden mb-2">
                  <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct * 100}%`, background: barColor }} />
                </div>
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted">{used} / 500k</span>
                  <span style={{ color: barColor }}>~{captures} left</span>
                </div>
                <p className="text-[10px] text-muted mt-1.5">Resets in {formatReset(resetIn)}</p>
                {warn && <p className="text-[10px] text-red-400 mt-1">Almost out of daily tokens!</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function HomePage({ onOpenNote }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const hubActionsRef = useRef(null);

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
      <header className="mb-8 flex items-center gap-3">
        <div>
          <h1 className="text-3xl font-extrabold bg-gradient-to-r from-accent to-teal bg-clip-text text-transparent">
            LookUp
          </h1>
          <p className="text-muted text-sm mt-0.5">Your personal learning hub</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={openChat}
            className="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-xl text-sm text-muted hover:text-text hover:border-accent/40 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            Chat
          </button>
          <ActionsDropdown onSearch={() => setSearchOpen(true)} hubActionsRef={hubActionsRef} />
        </div>
      </header>

      {searchOpen && (
        <GlobalSearch
          onClose={() => setSearchOpen(false)}
          onOpenNote={(filename) => { setSearchOpen(false); onOpenNote(filename); }}
        />
      )}

      <LearningHub onOpenNote={onOpenNote} actionsRef={hubActionsRef} />
    </div>
  );
}
