"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, FileText, Mic, Layers, BookOpen, HelpCircle, CreditCard } from "lucide-react";
import clsx from "clsx";

interface Note {
  filename: string;
  title?: string;
  mode?: string;
  size: number;
  modified: string;
}

type DateFilter = "today" | "week" | "month" | "all";
type SortMode   = "date" | "alpha";

// ── Group configuration ───────────────────────────────────────────────────────
const GROUP_CONFIG = {
  summary:   { label: "Summary",    icon: "📄", color: "bg-accent/20 text-accent border-accent/30",             Icon: FileText   },
  explain:   { label: "Explain",    icon: "📖", color: "bg-teal/20 text-teal border-teal/30",                   Icon: BookOpen   },
  quiz:      { label: "Quiz",       icon: "❓", color: "bg-amber-500/20 text-amber-400 border-amber-500/30",    Icon: HelpCircle },
  flashcard: { label: "Flashcards", icon: "🃏", color: "bg-orange-500/20 text-orange-400 border-orange-500/30", Icon: CreditCard },
  session:   { label: "Session",    icon: "📚", color: "bg-purple-500/20 text-purple-300 border-purple-500/30", Icon: Layers     },
  audio:     { label: "Audio",      icon: "🎙️", color: "bg-pink-500/20 text-pink-400 border-pink-500/30",       Icon: Mic        },
} as const;

const GROUP_ORDER = ["summary", "explain", "quiz", "flashcard", "session", "audio"] as const;
type GroupKey = typeof GROUP_ORDER[number];

function getGroupKey(mode: string | undefined): GroupKey {
  if (!mode) return "summary";
  if (mode.startsWith("audio")) return "audio";
  return (GROUP_ORDER as readonly string[]).includes(mode) ? (mode as GroupKey) : "summary";
}

const DATE_LABELS: Record<DateFilter, string> = {
  today: "Today",
  week:  "This week",
  month: "This month",
  all:   "All time",
};

export default function NotesList({ notes }: { notes: Note[] }) {
  const [query,          setQuery]          = useState("");
  const [dateFilter,     setDateFilter]     = useState<DateFilter>("all");
  const [sortMode,       setSortMode]       = useState<SortMode>("date");
  const [expandedGroups, setExpandedGroups] = useState<Set<GroupKey>>(new Set(GROUP_ORDER));
  const [showRange,      setShowRange]      = useState(false);
  const [rangeFrom,      setRangeFrom]      = useState("");
  const [rangeTo,        setRangeTo]        = useState("");

  // ── Filtered + grouped notes ────────────────────────────────────────────────
  const groups = useMemo(() => {
    const now   = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    const filtered = notes.filter((n) => {
      const d = new Date(n.modified);

      // Date filter
      if (showRange && (rangeFrom || rangeTo)) {
        if (rangeFrom && d < new Date(rangeFrom))               return false;
        if (rangeTo   && d > new Date(rangeTo + "T23:59:59"))   return false;
      } else {
        if (dateFilter === "today" && d < today)                                      return false;
        if (dateFilter === "week"  && d < new Date(today.getTime() - 6  * 86400000)) return false;
        if (dateFilter === "month" && d < new Date(today.getTime() - 29 * 86400000)) return false;
      }

      // Search
      if (query.trim()) {
        const q = query.toLowerCase();
        return (
          (n.title ?? n.filename).toLowerCase().includes(q) ||
          (n.mode ?? "").toLowerCase().includes(q)
        );
      }
      return true;
    });

    // Group by type
    const map = new Map<GroupKey, Note[]>();
    for (const n of filtered) {
      const key = getGroupKey(n.mode);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(n);
    }

    // Sort within each group
    for (const arr of map.values()) {
      if (sortMode === "date") {
        arr.sort((a, b) => b.modified.localeCompare(a.modified));
      } else {
        arr.sort((a, b) => (a.title ?? a.filename).localeCompare(b.title ?? b.filename));
      }
    }

    return GROUP_ORDER.filter((k) => map.has(k)).map((k) => ({ key: k, notes: map.get(k)! }));
  }, [notes, dateFilter, sortMode, query, rangeFrom, rangeTo, showRange]);

  const totalVisible = groups.reduce((s, g) => s + g.notes.length, 0);

  function toggleGroup(key: GroupKey) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  function selectDateFilter(f: DateFilter) {
    setDateFilter(f);
    setShowRange(false);
    setRangeFrom("");
    setRangeTo("");
  }

  return (
    <div>
      {/* ── Date filter + sort ──────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        {(Object.keys(DATE_LABELS) as DateFilter[]).map((f) => (
          <button
            key={f}
            onClick={() => selectDateFilter(f)}
            className={clsx(
              "px-3 py-1 text-xs font-semibold rounded-full border transition-colors",
              !showRange && dateFilter === f
                ? "bg-accent/20 border-accent/50 text-accent"
                : "border-border text-muted hover:border-accent/40 hover:text-text"
            )}
          >
            {DATE_LABELS[f]}
          </button>
        ))}
        <button
          onClick={() => setShowRange((s) => !s)}
          className={clsx(
            "px-3 py-1 text-xs font-semibold rounded-full border transition-colors",
            showRange
              ? "bg-accent/20 border-accent/50 text-accent"
              : "border-border text-muted hover:border-accent/40 hover:text-text"
          )}
        >
          📅 Range
        </button>

        {/* Sort toggle */}
        <div className="ml-auto flex rounded-lg overflow-hidden border border-border">
          {(["date", "alpha"] as SortMode[]).map((s) => (
            <button
              key={s}
              onClick={() => setSortMode(s)}
              className={clsx(
                "px-3 py-1 text-xs font-semibold transition-colors",
                sortMode === s ? "bg-accent/20 text-accent" : "text-muted hover:text-text"
              )}
            >
              {s === "date" ? "Date" : "A–Z"}
            </button>
          ))}
        </div>
      </div>

      {/* ── Custom date range picker ─────────────────────────────────────── */}
      {showRange && (
        <div className="flex flex-wrap items-center gap-3 mb-3 px-4 py-3 bg-surface border border-border rounded-xl">
          <span className="text-xs text-muted">From</span>
          <input
            type="date"
            value={rangeFrom}
            onChange={(e) => setRangeFrom(e.target.value)}
            className="text-xs bg-bg border border-border rounded-lg px-2 py-1 text-text outline-none focus:border-accent"
          />
          <span className="text-xs text-muted">to</span>
          <input
            type="date"
            value={rangeTo}
            onChange={(e) => setRangeTo(e.target.value)}
            className="text-xs bg-bg border border-border rounded-lg px-2 py-1 text-text outline-none focus:border-accent"
          />
          <button
            onClick={() => { setRangeFrom(""); setRangeTo(""); }}
            className="text-xs text-muted hover:text-text ml-auto transition-colors"
          >
            Clear
          </button>
        </div>
      )}

      {/* ── Search bar ──────────────────────────────────────────────────── */}
      <div className="relative mb-5">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-muted w-4 h-4" />
        <input
          type="text"
          placeholder="Search notes…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 bg-surface border border-border rounded-xl text-sm text-text placeholder:text-muted outline-none focus:border-accent transition-colors"
        />
      </div>

      {/* ── Empty state ─────────────────────────────────────────────────── */}
      {groups.length === 0 ? (
        <div className="text-center py-16 text-muted text-sm border border-dashed border-border rounded-xl">
          {query
            ? `No notes matching "${query}"`
            : "No notes for this period — capture something!"}
        </div>
      ) : (
        <>
          <p className="text-xs text-muted mb-4">
            {totalVisible} note{totalVisible !== 1 ? "s" : ""} · {groups.length} type{groups.length !== 1 ? "s" : ""}
          </p>

          {/* ── Grouped accordion ───────────────────────────────────────── */}
          <div className="flex flex-col gap-3">
            {groups.map(({ key, notes: groupNotes }) => {
              const cfg      = GROUP_CONFIG[key];
              const expanded = expandedGroups.has(key);

              return (
                <div key={key} className="border border-border rounded-xl overflow-hidden">
                  {/* Group header */}
                  <button
                    onClick={() => toggleGroup(key)}
                    className="w-full flex items-center gap-3 px-4 py-3.5 bg-surface hover:bg-surface/70 transition-colors"
                  >
                    <div className={clsx("p-1.5 rounded-lg border text-base leading-none shrink-0", cfg.color)}>
                      {cfg.icon}
                    </div>
                    <span className="text-sm font-semibold text-text">{cfg.label}</span>
                    <span className="text-xs text-muted">
                      {groupNotes.length} note{groupNotes.length !== 1 ? "s" : ""}
                    </span>
                    <span
                      className={clsx(
                        "ml-auto text-muted text-sm transition-transform duration-200",
                        expanded ? "rotate-90" : ""
                      )}
                    >
                      ▸
                    </span>
                  </button>

                  {/* Notes inside group */}
                  {expanded && (
                    <div className="border-t border-border">
                      {groupNotes.map((note) => (
                        <Link
                          key={note.filename}
                          href={`/note/${encodeURIComponent(note.filename)}`}
                          className="flex items-center gap-3 px-4 py-3 hover:bg-surface/40 transition-colors border-b border-border last:border-b-0"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-text truncate">
                              {note.title ?? note.filename}
                            </p>
                            <p className="text-xs text-muted mt-0.5">
                              {new Date(note.modified).toLocaleString()} · {(note.size / 1024).toFixed(1)} KB
                            </p>
                          </div>
                          <span className="text-muted text-xs shrink-0">→</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
