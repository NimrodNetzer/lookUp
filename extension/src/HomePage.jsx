import { useEffect, useState } from "react";
import LearningHub from "./LearningHub.jsx";
import GlobalSearch from "./GlobalSearch.jsx";

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

      <LearningHub onOpenNote={onOpenNote} onOpenChat={openChat} />
    </div>
  );
}
