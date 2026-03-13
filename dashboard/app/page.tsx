"use client";

import { useEffect, useState } from "react";
import LearningHub from "./components/LearningHub";
import CosmicBg from "./components/CosmicBg";

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

  useEffect(() => {
    fetch(`${GATEWAY}/notes`)
      .then(r => r.ok ? r.json() : [])
      .then(setNotes)
      .catch(() => {});

    fetch(`${GATEWAY}/stats`)
      .then(r => r.ok ? r.json() : { totalNotes: 0, streak: 0, thisWeek: 0 })
      .then(setStats)
      .catch(() => {});
  }, []);

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
        <div className="ml-auto flex gap-3">
          <StatPill icon="📚" label="Notes"  value={stats.totalNotes} />
          <StatPill icon="🔥" label="Streak" value={`${stats.streak}d`} />
          <StatPill icon="⚡" label="Week"   value={stats.thisWeek} />
        </div>
      </header>

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
