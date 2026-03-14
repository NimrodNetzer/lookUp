"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import Link from "next/link";
import NotesList from "./NotesList";
import CommandChat from "./CommandChat";
import { FolderNode } from "./FolderTree";
import { Plus, Pencil, Trash2, Check, X, ChevronRight, MessageSquare } from "lucide-react";
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
  { key: "audio",     label: "Audio",        icon: "🎙️" },
  { key: "chat",      label: "General Notes", icon: "💬" },
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

function countNotesRecursive(node: FolderNode, counts: Record<number, number>): number {
  return (counts[node.id] ?? 0) + node.children.reduce((s, c) => s + countNotesRecursive(c, counts), 0);
}

function flattenFolders(nodes: FolderNode[], depth = 0): { folder: FolderNode; depth: number }[] {
  return nodes.flatMap((n) => [{ folder: n, depth }, ...flattenFolders(n.children, depth + 1)]);
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
function FolderCard({ folder, noteCount, subfolderCount, onSelect, onDropNote, onRefresh, isSubfolder }: {
  folder: FolderNode;
  noteCount: number;
  subfolderCount: number;
  onSelect: (id: number) => void;
  onDropNote: (filename: string, folderId: number) => void;
  onRefresh: () => void;
  isSubfolder?: boolean;
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
        "relative group border-2 rounded-xl cursor-pointer transition-all select-none",
        isSubfolder
          ? "bg-surface/50 p-3"
          : "bg-surface p-5",
        dragOver
          ? "border-teal/60 bg-teal/10 scale-[1.02]"
          : isSubfolder
            ? "border-border/50 hover:border-accent/30 hover:bg-surface/80"
            : "border-border hover:border-accent/50 hover:shadow-md"
      )}
    >
      {/* Folder icon */}
      <div className={clsx("mb-2", isSubfolder ? "text-2xl" : "text-4xl mb-3")}>
        {dragOver ? "📂" : isSubfolder ? "🗂️" : "📁"}
      </div>

      {/* Name or rename input */}
      {renaming ? (
        <InlineInput
          initial={folder.name}
          placeholder="Folder name…"
          onConfirm={handleRename}
          onCancel={() => setRenaming(false)}
        />
      ) : (
        <p className={clsx("truncate pr-6", isSubfolder ? "text-xs font-medium text-muted" : "font-semibold text-sm text-text")}>
          {folder.name}
        </p>
      )}

      {/* Meta */}
      {!renaming && (
        <p className="text-[10px] text-muted/70 mt-1">
          {noteCount} note{noteCount !== 1 ? "s" : ""}
          {subfolderCount > 0 && ` · ${subfolderCount} sub`}
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

// ── Sidebar drop target — "Unsorted" button that also accepts drops ───────────
function SidebarDropTarget({ label, count, active, onClick, onDrop }: {
  label: string; count: number; active: boolean;
  onClick: () => void; onDrop: (filename: string) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <button
      onClick={onClick}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.getData("text/plain"); if (f) onDrop(f); }}
      className={clsx(
        "text-left px-4 py-2 text-xs transition-colors flex items-center justify-between",
        dragOver ? "bg-teal/15 text-teal border-l-2 border-teal/60"
          : active ? "bg-accent/15 text-accent font-semibold"
          : "text-muted hover:text-text hover:bg-surface/60"
      )}
    >
      <span>{label}</span>
      <span className="text-[10px]">{count}</span>
    </button>
  );
}

// ── Sidebar folder row — drop target + click to navigate ─────────────────────
function SidebarFolderDropTarget({ folder, depth, onDrop, onSelect }: {
  folder: FolderNode; depth: number;
  onDrop: (filename: string) => void;
  onSelect: (id: number) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  return (
    <button
      onClick={() => onSelect(folder.id)}
      onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.getData("text/plain"); if (f) onDrop(f); }}
      style={{ paddingLeft: `${16 + depth * 12}px` }}
      className={clsx(
        "w-full text-left flex items-center gap-1.5 py-1.5 pr-3 text-xs transition-colors rounded-sm",
        dragOver ? "bg-teal/15 text-teal" : "text-muted hover:text-text hover:bg-surface/60"
      )}
    >
      <span className="text-sm">{dragOver ? "📂" : "📁"}</span>
      <span className="truncate">{folder.name}</span>
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function LearningHub({ notes, onRefresh }: { notes: Note[]; onRefresh?: () => void }) {
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);

  const [activeType,      setActiveType]      = useState<TypeKey | null>(null);
  const [folders,         setFolders]         = useState<FolderNode[]>([]);
  const [localNotes,      setLocalNotes]      = useState<Note[]>(notes);
  const [addingFolder,    setAddingFolder]    = useState(false);
  const [showUnattached,  setShowUnattached]  = useState(false);
  const [toast,           setToast]           = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchFolders = useCallback(async () => {
    try {
      const r = await fetch(`${GATEWAY}/folders`);
      if (r.ok) setFolders(await r.json());
    } catch {}
  }, []);

  const fetchNotes = useCallback(async () => {
    try {
      const r = await fetch(`${GATEWAY}/notes`);
      if (r.ok) setLocalNotes(await r.json());
    } catch {}
  }, []);

  useEffect(() => {
    fetchFolders();
    fetchNotes();
    // Clear any stale sessionStorage key from a previous version
    sessionStorage.removeItem("lookup_activeFolderId");
  }, [fetchFolders, fetchNotes]);

  const refresh = useCallback(() => {
    fetchNotes();
    fetchFolders();
    onRefresh?.();
  }, [fetchNotes, fetchFolders, onRefresh]);

  // Safety: if the active folder no longer exists in the tree, go back to root
  useEffect(() => {
    if (activeFolderId !== null && folders.length > 0) {
      const exists = findFolder(folders, activeFolderId);
      if (!exists) setActiveFolderId(null);
    }
  }, [folders, activeFolderId]);

  // Reset unattached view and type filter when navigating folders
  useEffect(() => {
    setShowUnattached(false);
    setActiveType(null);
  }, [activeFolderId]);

  // Notes with no folder assigned
  const unattachedNotes = useMemo(
    () => localNotes.filter((n) => !n.folder_id),
    [localNotes]
  );

  // Type counts for the current context (folder or unattached)
  const contextNotes = useMemo(
    () => activeFolderId !== null ? localNotes.filter((n) => n.folder_id === activeFolderId) : unattachedNotes,
    [localNotes, unattachedNotes, activeFolderId]
  );

  // Notes shown in the main area — switches to unattached when toggled inside a folder
  const showingNotes = useMemo(
    () => activeFolderId !== null && showUnattached ? unattachedNotes : contextNotes,
    [activeFolderId, showUnattached, unattachedNotes, contextNotes]
  );

  const contextTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const n of showingNotes) {
      const k = getTypeKey(n.mode);
      counts[k] = (counts[k] ?? 0) + 1;
    }
    return counts;
  }, [showingNotes]);

  // Direct note counts per folder (no children)
  const notesPerFolder = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const n of localNotes) {
      if (n.folder_id) counts[n.folder_id] = (counts[n.folder_id] ?? 0) + 1;
    }
    return counts;
  }, [localNotes]);

  // Recursive note counts (folder + all descendants)
  const totalNotesPerFolder = useMemo(() => {
    const result: Record<number, number> = {};
    function fill(nodes: FolderNode[]) {
      for (const node of nodes) {
        fill(node.children);
        result[node.id] = countNotesRecursive(node, notesPerFolder);
      }
    }
    fill(folders);
    return result;
  }, [folders, notesPerFolder]);

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

  // Parent folder id for the back button (null = go back to root)
  const parentFolderId = folderPath.length >= 2 ? folderPath[folderPath.length - 2].id : null;

  // Notes visible in the main area: folder contents or unattached, filtered by type
  const visibleNotes = useMemo(() => {
    return activeType !== null ? showingNotes.filter((n) => getTypeKey(n.mode) === activeType) : showingNotes;
  }, [showingNotes, activeType]);

  function showToast(msg: string) {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2500);
  }

  async function handleDropNote(filename: string, folderId: number) {
    try {
      await fetch(`${GATEWAY}/notes/${encodeURIComponent(filename)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ folder_id: folderId === -1 ? null : folderId }),
      });
      const targetName = folderId === -1
        ? "Unsorted"
        : (findFolder(folders, folderId)?.name ?? "folder");
      showToast(`Moved to "${targetName}"`);
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

  const typeLabel = TYPE_GROUPS.find((g) => g.key === activeType)?.label;
  const notesLabel = activeFolderId !== null && showUnattached
    ? (activeType ? `Unsorted — ${typeLabel}` : "Unsorted Notes")
    : activeFolderId !== null
      ? (activeType ? `${activeFolder?.name ?? "Folder"} — ${typeLabel}` : (activeFolder?.name ?? "Folder"))
      : (activeType ? `Unsorted — ${typeLabel}` : "Unsorted Notes");

  return (
    <div className="flex gap-6 items-start relative">
      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-surface border border-border rounded-xl px-5 py-2.5 text-sm text-text shadow-lg pointer-events-none animate-fadeIn">
          {toast}
        </div>
      )}
      {/* ── Left sidebar — unattached type filter + AI Organiser ─────────── */}
      <aside className="w-52 flex-shrink-0 sticky top-8 flex flex-col gap-3">

        {/* Type filter */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border">
            <span className="text-xs font-semibold text-muted uppercase tracking-widest">
              {activeFolderId !== null ? "Filter" : "Unsorted"}
            </span>
          </div>
          <div className="flex flex-col py-1">
            <button
              onClick={() => { setActiveType(null); setShowUnattached(false); }}
              className={clsx(
                "text-left px-4 py-2 text-xs transition-colors flex items-center justify-between",
                activeType === null && !showUnattached
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-muted hover:text-text hover:bg-surface/60"
              )}
            >
              <span>{activeFolderId !== null ? "All notes" : "All unsorted"}</span>
              <span className="text-[10px]">{contextNotes.length}</span>
            </button>
            {TYPE_GROUPS.map(({ key, label, icon }) => {
              const count = contextTypeCounts[key] ?? 0;
              if (count === 0 && !showUnattached) return null;
              if (count === 0) return null;
              return (
                <button
                  key={key}
                  onClick={() => { setActiveType(activeType === key ? null : key); setShowUnattached(false); }}
                  className={clsx(
                    "text-left px-4 py-2 text-xs transition-colors flex items-center gap-2",
                    activeType === key && !showUnattached
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
            {activeFolderId !== null && (
              <>
                <div className="mx-3 my-1 border-t border-border/50" />
                <SidebarDropTarget
                  label="Unsorted"
                  count={unattachedNotes.length}
                  active={showUnattached}
                  onClick={() => { setShowUnattached((v) => !v); setActiveType(null); }}
                  onDrop={(filename) => handleDropNote(filename, -1)}
                />
              </>
            )}
          </div>
        </div>

        {/* Folder drop targets */}
        {folders.length > 0 && (
          <div className="bg-surface border border-border rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border">
              <span className="text-xs font-semibold text-muted uppercase tracking-widest">Drop to folder</span>
            </div>
            <div className="flex flex-col py-1 max-h-48 overflow-y-auto">
              {flattenFolders(folders).map(({ folder, depth }) => (
                <SidebarFolderDropTarget
                  key={folder.id}
                  folder={folder}
                  depth={depth}
                  onDrop={(filename) => handleDropNote(filename, folder.id)}
                  onSelect={setActiveFolderId}
                />
              ))}
            </div>
          </div>
        )}

        {/* AI Organiser */}
        <CommandChat onRefresh={refresh} />
      </aside>

      {/* ── Main area — folder cards + notes ──────────────────────────────── */}
      <main className="flex-1 min-w-0 flex flex-col gap-5">

        {/* Breadcrumb + back button */}
        <div className="flex items-center gap-3 justify-between">
          <div className="flex items-center gap-3">
            {activeFolderId !== null && (
              <button
                onClick={() => setActiveFolderId(parentFolderId)}
                className="flex items-center gap-1.5 text-xs text-muted hover:text-text transition-colors px-2.5 py-1.5 rounded-lg border border-border hover:border-accent/40 bg-surface"
              >
                ← Back
              </button>
            )}
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
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setAddingFolder((v) => !v)}
              className={clsx(
                "flex items-center gap-1.5 px-3 py-1.5 bg-surface border rounded-lg transition-colors text-xs font-semibold",
                addingFolder
                  ? "border-accent/50 text-accent"
                  : "border-border text-muted hover:border-accent/50 hover:text-accent"
              )}
            >
              <Plus className="w-3.5 h-3.5" />
              New folder
            </button>
            <Link
              href="/chat"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-muted hover:text-accent border border-border hover:border-accent/40 bg-surface rounded-lg transition-colors"
            >
              <MessageSquare className="w-3.5 h-3.5" />
              Chat
            </Link>
          </div>
        </div>

        {/* Inline new-folder input — shown below header when active */}
        {addingFolder && (
          <div className="flex items-center gap-2 bg-surface border border-accent/40 rounded-lg px-3 py-2 self-start">
            <span className="text-base">📁</span>
            <InlineInput
              placeholder="Folder name…"
              onConfirm={handleCreateFolder}
              onCancel={() => setAddingFolder(false)}
            />
          </div>
        )}

        {/* Folder cards grid */}
        {displayFolders.length > 0 && (
          <div>
            {activeFolderId !== null && (
              <p className="text-xs font-semibold text-muted uppercase tracking-widest mb-3">
                Subfolders
              </p>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 items-start">
              {displayFolders.map((folder) => (
                <FolderCard
                  key={folder.id}
                  folder={folder}
                  noteCount={totalNotesPerFolder[folder.id] ?? 0}
                  subfolderCount={folder.children.length}
                  onSelect={setActiveFolderId}
                  onDropNote={handleDropNote}
                  onRefresh={refresh}
                  isSubfolder={activeFolderId !== null}
                />
              ))}
            </div>
          </div>
        )}

        {/* Notes section */}
        <div>
          <div className="flex items-center gap-3 mb-4 pb-2 border-b border-border">
            <h2 className="text-sm font-bold text-text">
              {notesLabel}
            </h2>
            {activeType !== null && (
              <span className="text-xs bg-accent/10 text-accent/80 px-2 py-0.5 rounded-full border border-accent/20">
                {TYPE_GROUPS.find((g) => g.key === activeType)?.label}
              </span>
            )}
            <span className="text-xs text-muted ml-auto">{visibleNotes.length} note{visibleNotes.length !== 1 ? "s" : ""}</span>
          </div>
          {visibleNotes.length === 0 && activeFolderId !== null && !showUnattached ? (
            <div className="text-center py-12 text-muted text-sm border border-dashed border-border/50 rounded-xl">
              <p className="text-2xl mb-2">📭</p>
              <p className="font-medium">This folder is empty</p>
              <p className="text-xs mt-1 text-muted/70">Drag notes here, or capture something from the extension</p>
            </div>
          ) : (
            <NotesList notes={visibleNotes} folders={folders} onRefresh={refresh} />
          )}
        </div>


      </main>
    </div>
  );
}
