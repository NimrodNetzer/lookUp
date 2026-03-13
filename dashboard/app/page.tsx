"use client";

import { useEffect, useState } from "react";
import LearningHub from "./components/LearningHub";
import CosmicBg from "./components/CosmicBg";
import SetupScreen from "./components/SetupScreen";
import ExtensionScreen from "./components/ExtensionScreen";
import GlobalSearch from "./components/GlobalSearch";

const GATEWAY = "http://127.0.0.1:18789";

interface Note {
  filename: string;
  title?: string;
  mode?: string;
  course?: string;
  folder_id?: number;
  size: number;
  modified: string;
}

interface Stats {
  totalNotes: number;
  streak: number;
  thisWeek: number;
}

export default function HomePage() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [stats, setStats] = useState<Stats>({ totalNotes: 0, streak: 0, thisWeek: 0 });
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [extSetupDone, setExtSetupDone] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") { e.preventDefault(); setSearchOpen(true); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    setExtSetupDone(localStorage.getItem("lookup_ext_setup_done") === "1");
    fetch(`${GATEWAY}/setup/status`)
      .then(r => r.ok ? r.json() : { configured: true })
      .then(d => setConfigured(d.configured))
      .catch(() => setConfigured(true));
  }, []);

  useEffect(() => {
    if (!configured || !extSetupDone) return;
    fetch(`${GATEWAY}/notes`)
      .then(r => r.ok ? r.json() : [])
      .then(setNotes)
      .catch(() => {});

    fetch(`${GATEWAY}/stats`)
      .then(r => r.ok ? r.json() : { totalNotes: 0, streak: 0, thisWeek: 0 })
      .then(setStats)
      .catch(() => {});
  }, [configured, extSetupDone]);

  if (configured === null) return <CosmicBg />;

  if (!configured) return (
    <>
      <CosmicBg />
      <SetupScreen onDone={() => setConfigured(true)} />
    </>
  );

  if (!extSetupDone) return (
    <>
      <CosmicBg />
      <ExtensionScreen onDone={() => {
        localStorage.setItem("lookup_ext_setup_done", "1");
        setExtSetupDone(true);
      }} />
    </>
  );

  return (
    <>
    <CosmicBg />
    <div className="relative z-10 max-w-5xl mx-auto px-5 py-8">
      <header className="mb-8 flex items-end gap-6">
        <div>
          <h1 className="text-3xl font-extrabold bg-gradient-to-r from-accent to-teal bg-clip-text text-transparent">
            LookUp
          </h1>
          <p className="text-muted text-sm mt-1">Your personal learning hub</p>
        </div>
        <div className="ml-auto flex items-center gap-3">
          <button
            onClick={() => setSearchOpen(true)}
            className="flex items-center gap-2 px-3 py-2 bg-surface border border-border rounded-xl text-sm text-muted hover:text-text hover:border-accent/40 transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
            Search notes
            <span className="text-xs border border-border rounded px-1 py-0.5 font-mono opacity-60">⌘K</span>
          </button>
          <StatPill icon="📚" label="Notes"  value={stats.totalNotes} />
          <StatPill icon="🔥" label="Streak" value={`${stats.streak}d`} />
          <StatPill icon="⚡" label="Week"   value={stats.thisWeek} />
        </div>
      </header>

      {searchOpen && <GlobalSearch onClose={() => setSearchOpen(false)} />}
      <LearningHub notes={notes} />
    </div>
    </>
  );
}

function StatPill({ icon, label, value }: { icon: string; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-2 bg-surface border border-border rounded-xl px-4 py-2.5">
      <span className="text-base leading-none">{icon}</span>
      <div>
        <p className="text-sm font-bold text-text leading-none">{value}</p>
        <p className="text-xs text-muted mt-0.5">{label}</p>
      </div>
    </div>
  );
}
