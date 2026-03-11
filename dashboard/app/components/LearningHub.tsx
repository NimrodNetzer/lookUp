"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useRouter } from "next/navigation";
import NotesList from "./NotesList";
import CommandChat from "./CommandChat";
import { FolderNode } from "./FolderTree";
import { Plus, Pencil, Trash2, Check, X, ChevronRight } from "lucide-react";
import clsx from "clsx";

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

const TYPE_GROUPS = [
  { key: "summary",   label: "Summary",    icon: "📄" },
  { key: "explain",   label: "Explain",    icon: "📖" },
  { key: "quiz",      label: "Quiz",       icon: "❓" },
  { key: "flashcard", label: "Flashcards", icon: "🃏" },
  { key: "session",   label: "Session",    icon: "📚" },
  { key: "audio",     label: "Audio",      icon: "🎙️" },
] as const;

type TypeKey = typeof TYPE_GROUPS[number]["key"];

function getTypeKey(mode: string | undefined): TypeKey {
  if (!mode) return "summary";
  if (mode.startsWith("audio")) return "audio";
  const keys: string[] = TYPE_GROUPS.map((g) => g.key);
  return keys.includes(mode) ? (mode as TypeKey) : "summary";
}

function findFolder(nodes: FolderNode[], id: number): FolderNode | null {
  for (const n of nodes) {
    if (n.id === id) return n;
    const found = findFolder(n.children, id);
    if (found) return found;
  }
  return null;
}

function getFolderPath(nodes: FolderNode[], id: number): FolderNode[] {
  for (const n of nodes) {
    if (n.id === id) return [n];
    const sub = getFolderPath(n.children, id);
    if (sub.length > 0) return [n, ...sub];
  }
  return [];
}

// ── Inline text input ─────────────────────────────────────────────────────────
function InlineInput({ initial = "", placeholder, onConfirm, onCancel }: {
  initial?: string;
  placeholder: string;
  onConfirm: (v: string) => void;
  onCancel: () => void;
}) {
  const [val, setVal] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  return (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      <input
        ref={ref}
        type="text"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && val.trim()) onConfirm(val.trim());
          if (e.key === "Escape") onCancel();
        }}
        placeholder={placeholder}
        className="flex-1 min-w-0 bg-bg border border-accent/50 rounded px-2 py-1 text-sm text-text outline-none"
      />
      <button onClick={() => val.trim() && onConfirm(val.trim())} className="text-teal hover:text-teal/70 shrink-0">
        <Check className="w-3.5 h-3.5" />
      </button>
      <button onClick={onCancel} className="text-muted hover:text-text shrink-0">
        <X className="w-3.5 h-3.5" />
      </button>
    </div>
  );
}

// ── Folder card ───────────────────────────────────────────────────────────────
function FolderCard({ folder, noteCount, subfolderCount, onSelect, onDropNote, onRefresh }: {
  folder: FolderNode;
  noteCount: number;
  subfolderCount: number;
  onSelect: (id: number) => void;
  onDropNote: (filename: string, folderId: number) => void;
  onRefresh: () => void;
}) {
  const [dragOver,   setDragOver]   = useState(false);
  const [renaming,   setRenaming]   = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleRename(name: string) {
    await fetch(`${GATEWAY}/folders/${folder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    setRenaming(false);
    onRefresh();
  }

  async function handleDelete() {
    await fetch(`${GATEWAY}/folders/${folder.id}`, { method: "DELETE" });
    onRefresh();
  }

  return (
    <div
      onClick={() => !renaming && !confirming && onSelect(folder.id)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        const filename = e.dataTransfer.getData("text/plain");
        if (filename) onDropNote(filename, folder.id);
      }}
      className={clsx(
        "relative group bg-surface border-2 rounded-xl p-5 cursor-pointer transition-all select-none",
        dragOver
          ? "border-teal/60 bg-teal/10 scale-[1.02]"
          : "border-border hover:border-accent/50 hover:shadow-md"
      )}
    >
      {/* Folder icon */}
      <div className="text-4xl mb-3">{dragOver ? "📂" : "📁"}</div>

      {/* Name or rename input */}
      {renaming ? (
        <InlineInput
          initial={folder.name}
          placeholder="Folder name…"
          onConfirm={handleRename}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <p className="font-semibold text-sm text-text truncate pr-6">{folder.name}</p>
      )}

      {/* Meta */}
      {!renaming && (
        <p className="text-xs text-muted mt-1.5">
          {noteCount} note{noteCount !== 1 ? "s" : ""}
          {subfolderCount > 0 && ` · ${subfolderCount} folder${subfolderCount !== 1 ? "s" : ""}`}
        </p>
      )}

      {/* Navigate arrow */}
      {!renaming && !confirming && (
        <ChevronRight className="absolute right-3 bottom-5 w-4 h-4 text-muted/30 group-hover:text-muted/70 transition-colors" />
      )}

      {/* Action buttons on hover */}
      {!renaming && !confirming && (
        <div
          className="absolute top-2 right-2 hidden group-hover:flex items-center gap-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            title="Rename"
            onClick={() => setRenaming(true)}
            className="p-1 rounded hover:bg-accent/15 text-muted hover:text-accent transition-colors"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button
            title="Delete"
            onClick={() => setConfirming(true)}
            className="p-1 rounded hover:bg-red-500/15 text-muted hover:text-red-400 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Delete confirmation overlay */}
      {confirming && (
        <div
          className="absolute inset-0 bg-surface/95 rounded-xl flex flex-col items-center justify-center gap-3 p-4"
          onClick={(e) => e.stopPropagation()}
        >
          <p className="text-xs text-text font-semibold text-center">Delete "{folder.name}"?</p>
          <div className="flex gap-2">
            <button
              onClick={handleDelete}
              className="px-3 py-1 text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/30 font-semibold transition-colors"
            >
              Delete
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-3 py-1 text-xs text-muted hover:text-text border border-border rounded-lg transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function LearningHub({ notes }: { notes: Note[] }) {
  const router = useRouter();
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [activeType,     setActiveType]     = useState<TypeKey | null>(null);
  const [folders,        setFolders]        = useState<FolderNode[]>([]);
  const [addingFolder,   setAddingFolder]   = useState(false);

  const fetchFolders = useCallback(async () => {
    try {
      const r = await fetch(`${GATEWAY}/folders`);
      if (r.ok) setFolders(await r.json());
    } catch {}
  }, []);

  useEffect(() => { fetchFolders(); }, [fetchFolders]);

  const refresh = useCallback(() => {
    router.refresh();
    fetchFolders();
  }, [router, fetchFolders]);

  // Notes with no folder assigned
  const unattachedNotes = useMemo(
    () => notes.filter((n) => !n.folder_id),
    [notes]
  );

  // Type counts for unattached notes only
  const unattachedTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of unattachedNotes) {
      const k = getTypeKey(n.mode);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [unattachedNotes]);

  // Note counts per folder
  const notesPerFolder = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const n of notes) {
      if (n.folder_id) counts[n.folder_id] = (counts[n.folder_id] ?? 0) + 1;
    }
    return counts;
  }, [notes]);

  // Active folder node and its immediate children (subfolders)
  const activeFolder = useMemo(
    () => (activeFolderId !== null ? findFolder(folders, activeFolderId) : null),
    [folders, activeFolderId]
  );

  // Folders to show as cards: root-level when at top, or subfolders when inside a folder
  const displayFolders = activeFolderId === null ? folders : (activeFolder?.children ?? []);

  // Breadcrumb path
  const folderPath = useMemo(
    () => (activeFolderId !== null ? getFolderPath(folders, activeFolderId) : []),
    [folders, activeFolderId]
  );

  // Notes visible in the main area: folder contents or unattached, filtered by type
  const visibleNotes = useMemo(() => {
    const base = activeFolderId !== null
      ? notes.filter((n) => n.folder_id === activeFolderId)
      : unattachedNotes;
    return activeType !== null ? base.filter((n) => getTypeKey(n.mode) === activeType) : base;
  }, [notes, unattachedNotes, activeFolderId, activeType]);

  async function handleDropNote(filename: string, folderId: number) {
    try {
      await fetch(`${GATEWAY}/notes/${encodeURIComponent(filename)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId }),
      });
      refresh();
    } catch {}
  }

  async function handleCreateFolder(name: string) {
    await fetch(`${GATEWAY}/folders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, parentId: activeFolderId }),
    });
    setAddingFolder(false);
    fetchFolders();
  }

  const notesLabel = activeFolderId !== null
    ? (activeFolder?.name ?? "Folder")
    : (activeType ? `Unattached — ${TYPE_GROUPS.find((g) => g.key === activeType)?.label}` : "Unattached Notes");

  return (
    <div className="flex gap-6 items-start">
      {/* ── Left sidebar — unattached type filter + AI Organiser ─────────── */}
      <aside className="w-48 flex-shrink-0 sticky top-8 flex flex-col gap-3">

        {/* Unattached notes type filter */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-xs font-semibold text-muted uppercase tracking-widest">Unattached</span>
          </div>
          <div className="flex flex-col py-1">
            <button
              onClick={() => { setActiveFolderId(null); setActiveType(null); }}
              className={clsx(
                "text-left px-4 py-2 text-xs transition-colors flex items-center justify-between",
                activeFolderId === null && activeType === null
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-muted hover:text-text hover:bg-surface/60"
              )}
            >
              <span>All unattached</span>
              <span className="text-[10px]">{unattachedNotes.length}</span>
            </button>
            {TYPE_GROUPS.map(({ key, label, icon }) => {
              const count = unattachedTypeCounts[key] ?? 0;
              if (count === 0) return null;
              return (
                <button
                  key={key}
                  onClick={() => { setActiveFolderId(null); setActiveType(activeType === key ? null : key); }}
                  className={clsx(
                    "text-left px-4 py-2 text-xs transition-colors flex items-center gap-2",
                    activeFolderId === null && activeType === key
                      ? "bg-accent/15 text-accent font-semibold"
                      : "text-muted hover:text-text hover:bg-surface/60"
                  )}
                >
                  <span>{icon}</span>
                  <span className="flex-1 truncate">{label}</span>
                  <span className="text-[10px]">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* AI Organiser */}
        <CommandChat onRefresh={refresh} />
      </aside>

      {/* ── Main area — folder cards + notes ──────────────────────────────── */}
      <main className="flex-1 min-w-0 flex flex-col gap-5">

        {/* Breadcrumb */}
        <nav className="flex items-center gap-1.5 text-xs flex-wrap">
          <button
            onClick={() => { setActiveFolderId(null); setActiveType(null); }}
            className={clsx(
              "font-semibold transition-colors",
              activeFolderId === null ? "text-text" : "text-muted hover:text-text"
            )}
          >
            Folders
          </button>
          {folderPath.map((f, i) => (
            <span key={f.id} className="flex items-center gap-1.5">
              <ChevronRight className="w-3 h-3 text-muted/50" />
              <button
                onClick={() => setActiveFolderId(f.id)}
                className={clsx(
                  "font-semibold transition-colors",
                  i === folderPath.length - 1 ? "text-text" : "text-muted hover:text-text"
                )}
              >
                {f.name}
              </button>
            </span>
          ))}
        </nav>

        {/* Folder cards grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
          {displayFolders.map((folder) => (
            <FolderCard
              key={folder.id}
              folder={folder}
              noteCount={notesPerFolder[folder.id] ?? 0}
              subfolderCount={folder.children.length}
              onSelect={setActiveFolderId}
              onDropNote={handleDropNote}
              onRefresh={refresh}
            />
          ))}

          {/* New folder card */}
          {addingFolder ? (
            <div className="bg-surface border-2 border-accent/40 rounded-xl p-5">
              <div className="text-4xl mb-3">📁</div>
              <InlineInput
                placeholder="Folder name…"
                onConfirm={handleCreateFolder}
                onCancel={() => setAddingFolder(false)}
              />
            </div>
          ) : (
            <button
              onClick={() => setAddingFolder(true)}
              className="bg-surface border-2 border-dashed border-border rounded-xl p-5 flex flex-col items-center justify-center gap-2 text-muted hover:text-accent hover:border-accent/50 transition-colors min-h-[110px]"
            >
              <Plus className="w-6 h-6" />
              <span className="text-xs font-semibold">New folder</span>
            </button>
          )}
        </div>

        {/* Notes section */}
        <div>
          <div className="flex items-center gap-2 mb-4">
            <h2 className="text-sm font-semibold text-muted uppercase tracking-widest">
              {notesLabel}
            </h2>
            {activeType !== null && activeFolderId !== null && (
              <span className="text-xs bg-accent/10 text-accent/80 px-2 py-0.5 rounded-full border border-accent/20">
                {TYPE_GROUPS.find((g) => g.key === activeType)?.label}
              </span>
            )}
            <span className="text-xs text-muted">— {visibleNotes.length}</span>
          </div>
          <NotesList notes={visibleNotes} onRefresh={refresh} />
        </div>
      </main>
    </div>
  );
}
