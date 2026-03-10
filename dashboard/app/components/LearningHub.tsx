"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import NotesList from "./NotesList";
import CommandChat from "./CommandChat";
import { FolderOpen } from "lucide-react";
import clsx from "clsx";

interface Note {
  filename: string;
  title?: string;
  mode?: string;
  course?: string;
  size: number;
  modified: string;
}

export default function LearningHub({ notes }: { notes: Note[] }) {
  const router = useRouter();
  const [activeCourse, setActiveCourse] = useState<string | null>(null);

  const refresh = useCallback(() => router.refresh(), [router]);

  // Derive unique courses
  const courses = Array.from(
    new Set(notes.map((n) => n.course).filter(Boolean) as string[])
  ).sort();

  const visibleNotes = activeCourse
    ? notes.filter((n) => n.course === activeCourse)
    : notes;

  return (
    <div className="flex gap-6 items-start">
      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-52 flex-shrink-0 sticky top-8 flex flex-col gap-3">
        {/* Courses */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <FolderOpen className="w-3.5 h-3.5 text-muted" />
            <span className="text-xs font-semibold text-muted uppercase tracking-widest">Courses</span>
          </div>
          <div className="flex flex-col">
            <button
              onClick={() => setActiveCourse(null)}
              className={clsx(
                "text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between",
                activeCourse === null
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-muted hover:text-text hover:bg-surface/60"
              )}
            >
              <span>All notes</span>
              <span className="text-xs">{notes.length}</span>
            </button>
            {courses.map((c) => {
              const count = notes.filter((n) => n.course === c).length;
              return (
                <button
                  key={c}
                  onClick={() => setActiveCourse(c === activeCourse ? null : c)}
                  className={clsx(
                    "text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between border-t border-border/50",
                    activeCourse === c
                      ? "bg-accent/15 text-accent font-semibold"
                      : "text-muted hover:text-text hover:bg-surface/60"
                  )}
                >
                  <span className="truncate pr-1">{c}</span>
                  <span className="text-xs flex-shrink-0">{count}</span>
                </button>
              );
            })}
            {courses.length === 0 && (
              <p className="px-4 py-3 text-xs text-muted/60 italic">
                No courses yet — use the AI command below
              </p>
            )}
          </div>
        </div>

        {/* AI Command Chat */}
        <CommandChat onRefresh={refresh} />
      </aside>

      {/* ── Main notes area ──────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-widest">
            {activeCourse ? activeCourse : "All Notes"}
          </h2>
          <span className="text-xs text-muted">— {visibleNotes.length}</span>
        </div>
        <NotesList notes={visibleNotes} onRefresh={refresh} />
      </main>
    </div>
  );
}
