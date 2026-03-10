"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import NotesList from "./NotesList";
import CommandChat from "./CommandChat";
import FolderTree, { FolderNode } from "./FolderTree";
import { FolderOpen } from "lucide-react";
import clsx from "clsx";

const GATEWAY = "http://127.0.0.1:18789";

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
  const [activeFolderId, setActiveFolderId] = useState<number | null>(null);
  const [folders,        setFolders]        = useState<FolderNode[]>([]);

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

  // Count notes per folder (using course field as folder name for now)
  const noteCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    // Will be properly wired once folder_id is in note frontmatter
    return counts;
  }, [notes]);

  // Filter notes by active folder (course-based for now, folder_id-based later)
  const visibleNotes = activeFolderId == null ? notes : notes; // full filter in Phase 4

  return (
    <div className="flex gap-6 items-start">
      {/* ── Left sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-52 flex-shrink-0 sticky top-8 flex flex-col gap-3">

        {/* Folder tree */}
        <div className="bg-surface border border-border rounded-xl overflow-hidden">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <FolderOpen className="w-3.5 h-3.5 text-muted" />
            <span className="text-xs font-semibold text-muted uppercase tracking-widest">Folders</span>
          </div>

          <div className="flex flex-col py-1">
            {/* All notes */}
            <button
              onClick={() => setActiveFolderId(null)}
              className={clsx(
                "text-left px-4 py-2 text-xs transition-colors flex items-center justify-between",
                activeFolderId === null
                  ? "bg-accent/15 text-accent font-semibold"
                  : "text-muted hover:text-text hover:bg-surface/60"
              )}
            >
              <span>All notes</span>
              <span className="text-[10px]">{notes.length}</span>
            </button>

            <div className="border-t border-border/50 mt-1 pt-1 px-1">
              <FolderTree
                folders={folders}
                activeFolderId={activeFolderId}
                onSelectFolder={setActiveFolderId}
                onRefresh={refresh}
                noteCounts={noteCounts}
              />
            </div>
          </div>
        </div>

        {/* AI Command Chat */}
        <CommandChat onRefresh={refresh} />
      </aside>

      {/* ── Main notes area ──────────────────────────────────────────────── */}
      <main className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-4">
          <h2 className="text-sm font-semibold text-muted uppercase tracking-widest">
            {activeFolderId == null ? "All Notes" : (
              folders.flatMap(function flatten(f): FolderNode[] { return [f, ...f.children.flatMap(flatten)]; })
                     .find(f => f.id === activeFolderId)?.name ?? "Folder"
            )}
          </h2>
          <span className="text-xs text-muted">— {visibleNotes.length}</span>
        </div>
        <NotesList notes={visibleNotes} onRefresh={refresh} />
      </main>
    </div>
  );
}
