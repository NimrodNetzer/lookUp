import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs/promises";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { exec } from "child_process";
import { analyzeScreenshot, analyzeMulti, analyzeText, analyzeWithQuestion, transcribeAndSummarize, chat, processCommand } from "./groq.js";
import { logActivity, getActivity, getStreak, getSetting, setSetting,
         getActiveConversation, createConversation, saveConversation, getConversation,
         listConversations, touchConversation, deleteConversation, renameConversation,
         reorderConversations, mergeConversations,
         getFolderTree, createFolder, renameFolder, deleteFolder } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// When running as a pkg exe, paths are relative to the exe; in dev, to the project root.
const BASE_DIR = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, "..");
const NOTES_DIR = path.join(BASE_DIR, "notes");
// When packaged: serve from a real "www" folder next to the exe.
// pkg's virtual filesystem doesn't work reliably with express.static.
const STATIC_DIR = process.pkg
  ? path.join(path.dirname(process.execPath), "www")
  : path.join(__dirname, "../dashboard/out");

const app = express();
const PORT = process.env.PORT || 18789;

app.use(cors({
  origin: (origin, cb) => {
    const allowed = [/^chrome-extension:\/\//, /^http:\/\/localhost/, /^http:\/\/127\.0\.0\.1/];
    if (!origin || allowed.some((r) => r.test(origin))) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
}));

app.use(express.json({ limit: "50mb" }));
mkdirSync(NOTES_DIR, { recursive: true });

/** Write (or overwrite) the single note file for a conversation. */
async function writeConversationNote(conv) {
  const title = (conv.title ?? "New conversation").replace(/"/g, '\\"');
  const filename = `conv-${conv.id}.md`;
  const frontmatter = `---\ntitle: "${title}"\ndate: "${new Date().toISOString()}"\nmode: "chat"\nconversation_id: "${conv.id}"\n---\n\n`;
  let body = "";
  for (const msg of conv.messages) {
    if (msg.role === "user") {
      body += `**You:** ${msg.content}\n\n`;
    } else {
      let cards = null;
      try {
        const p = JSON.parse(msg.content);
        if (Array.isArray(p) && p[0]?.front !== undefined) cards = p;
      } catch {}
      if (cards) {
        body += "**Flashcards:**\n\n" + cards.map((c, i) => `**Q${i + 1}:** ${c.front}\n**A:** ${c.back}`).join("\n\n") + "\n\n";
      } else {
        body += msg.content + "\n\n";
      }
    }
  }
  await fs.writeFile(path.join(NOTES_DIR, filename), frontmatter + body.trim(), "utf-8");
}

// --- Helpers ---
function makeTimestamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function makeSlug(str) { return str.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""); }

/** Append a user+assistant message pair to a conversation (used by capture endpoints) */
function appendToConversation(conversationId, userText, assistantContent) {
  if (!conversationId) return;
  const conv = getConversation(Number(conversationId));
  if (!conv) return;
  saveConversation(conv.id, [
    ...conv.messages,
    { role: "user",      content: userText },
    { role: "assistant", content: assistantContent },
  ]);
}

async function saveNote({ title, mode, markdown, cards, course }) {
  const ts = makeTimestamp();
  const name = title ? makeSlug(title) : mode;
  const filename = `${ts}_${name}.md`;
  const courseField = course ? `\ncourse: "${course}"` : "";
  const frontmatter = `---\ntitle: "${title ?? mode}"\ndate: "${new Date().toISOString()}"\nmode: "${mode}"${courseField}\n---\n\n`;
  await fs.writeFile(path.join(NOTES_DIR, filename), frontmatter + markdown, "utf-8");

  if (cards) {
    const cardsFile = `${ts}_${name}.cards.json`;
    await fs.writeFile(path.join(NOTES_DIR, cardsFile), JSON.stringify(cards, null, 2), "utf-8");
    return { filename, cardsFile, title: title ?? mode };
  }
  return { filename, title: title ?? mode };
}

async function mergeNotes(filenames, title) {
  const parts = await Promise.all(
    filenames.map(async (filename) => {
      if (!filename.endsWith(".md") || filename.includes("..")) throw new Error(`Invalid: ${filename}`);
      const content = await fs.readFile(path.join(NOTES_DIR, filename), "utf-8");
      const noteTitle = content.match(/^title:\s*"(.+)"/m)?.[1] ?? filename;
      const bodyMatch = content.match(/^---\n[\s\S]*?\n---\n\n?([\s\S]*)$/);
      const body = (bodyMatch?.[1] ?? content).trim();
      return { filename, title: noteTitle, body };
    })
  );

  const first   = await fs.readFile(path.join(NOTES_DIR, filenames[0]), "utf-8");
  const mode    = first.match(/^mode:\s*"(.+)"/m)?.[1]   ?? "summary";
  const course  = first.match(/^course:\s*"(.+)"/m)?.[1] ?? undefined;

  const combined = parts
    .map((p) => `## ${p.title}\n\n${p.body}`)
    .join("\n\n---\n\n");

  const mergeTitle = title ?? `Merged: ${parts.map((p) => p.title).join(" + ").slice(0, 80)}`;
  const saved = await saveNote({ title: mergeTitle, mode, markdown: combined, course });

  // Delete originals — the merged note replaces them
  await Promise.all(
    filenames.map((f) => fs.unlink(path.join(NOTES_DIR, f)).catch(() => {}))
  );

  return saved;
}

async function updateNoteFrontmatter(filename, updates) {
  const filepath = path.join(NOTES_DIR, filename);
  let content = await fs.readFile(filepath, "utf-8");
  for (const [key, value] of Object.entries(updates)) {
    const regex = new RegExp(`^${key}:.*$`, "m");
    const newLine = `${key}: "${String(value).replace(/"/g, '\\"')}"`;
    if (regex.test(content)) {
      content = content.replace(regex, newLine);
    } else {
      // insert before closing --- of frontmatter
      content = content.replace(/^(---\n[\s\S]*?)(\n---)/m, `$1\n${newLine}$2`);
    }
  }
  await fs.writeFile(filepath, content, "utf-8");
}

// --- POST /action — single screenshot ---
app.post("/action", async (req, res) => {
  const { screenshot, mimeType = "image/png", mode = "summary", title, conversationId } = req.body;
  if (!screenshot) return res.status(400).json({ error: "screenshot is required" });

  try {
    const raw = await analyzeScreenshot(screenshot, mimeType, mode);

    if (mode === "flashcard") {
      let cards;
      try {
        const jsonStr = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
        cards = JSON.parse(jsonStr);
      } catch {
        cards = [{ front: "Parse error", back: raw }];
      }
      const markdown = cards.map((c, i) => `**Q${i + 1}:** ${c.front}\n**A:** ${c.back}`).join("\n\n");
      const saved = await saveNote({ title: title ?? mode, mode, markdown, cards });
      logActivity();
      appendToConversation(conversationId, `📸 Screenshot (${mode})`, markdown);
      return res.json({ success: true, ...saved, markdown, cards, conversationId: conversationId ?? null });
    }

    const saved = await saveNote({ title: title ?? mode, mode, markdown: raw });
    logActivity();
    appendToConversation(conversationId, `📸 Screenshot (${mode})`, raw);
    res.json({ success: true, ...saved, markdown: raw, conversationId: conversationId ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /session — multi-page capture ---
app.post("/session", async (req, res) => {
  const { frames, title, mode = "session", conversationId } = req.body;
  if (!Array.isArray(frames) || frames.length === 0) {
    return res.status(400).json({ error: "frames array is required" });
  }

  try {
    const raw = await analyzeMulti(frames, mode);
    const sessionTitle = title ?? `Multi (${frames.length} pages)`;

    if (mode === "flashcard") {
      let cards;
      try {
        const jsonStr = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
        cards = JSON.parse(jsonStr);
      } catch {
        cards = [{ front: "Parse error", back: raw }];
      }
      const markdown = cards.map((c, i) => `**Q${i + 1}:** ${c.front}\n**A:** ${c.back}`).join("\n\n");
      const saved = await saveNote({ title: sessionTitle, mode, markdown, cards });
      logActivity();
      appendToConversation(conversationId, `📸 ${frames.length} pages (${mode})`, markdown);
      return res.json({ success: true, ...saved, markdown, cards, conversationId: conversationId ?? null });
    }

    const saved = await saveNote({ title: sessionTitle, mode, markdown: raw });
    logActivity();
    appendToConversation(conversationId, `📸 ${frames.length} pages (${mode})`, raw);
    res.json({ success: true, ...saved, markdown: raw, conversationId: conversationId ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /transcribe — audio capture ---
app.post("/transcribe", async (req, res) => {
  const { audio, mode = "summary", title, conversationId } = req.body;
  if (!audio) return res.status(400).json({ error: "audio (base64) is required" });

  try {
    const buffer = Buffer.from(audio, "base64");
    const { transcript, markdown } = await transcribeAndSummarize(buffer, mode);
    const audioTitle = title ?? "Audio recording";
    const audioMode = `audio-${mode}`;

    if (mode === "flashcard") {
      let cards;
      try { cards = JSON.parse(markdown); } catch { cards = [{ front: "Parse error", back: markdown }]; }
      const saved = await saveNote({ title: audioTitle, mode: audioMode, markdown, cards });
      logActivity();
      appendToConversation(conversationId, `🎙️ Audio recording (${mode})`, markdown);
      return res.json({ success: true, ...saved, transcript, markdown, cards, conversationId: conversationId ?? null });
    }

    const saved = await saveNote({ title: audioTitle, mode: audioMode, markdown });
    logActivity();
    appendToConversation(conversationId, `🎙️ Audio recording (${mode})`, markdown);
    res.json({ success: true, ...saved, transcript, markdown, conversationId: conversationId ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /ask-screen — screenshot + natural language question ---
app.post("/ask-screen", async (req, res) => {
  const { screenshot, mimeType = "image/png", question, title } = req.body;
  if (!screenshot || !question) return res.status(400).json({ error: "screenshot and question are required" });

  try {
    const markdown = await analyzeWithQuestion(screenshot, mimeType, question);
    const saved = await saveNote({ title: title ?? question.slice(0, 60), mode: "summary", markdown });
    logActivity();
    res.json({ success: true, ...saved, markdown });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /ask — text selection query (no screenshot) ---
app.post("/ask", async (req, res) => {
  const { selectedText, mode = "summary", title, conversationId } = req.body;
  if (!selectedText) return res.status(400).json({ error: "selectedText is required" });

  try {
    const raw = await analyzeText(selectedText, mode);
    const askTitle = title ?? "Selected text";

    if (mode === "flashcard") {
      let cards;
      try {
        const jsonStr = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
        cards = JSON.parse(jsonStr);
      } catch { cards = [{ front: "Parse error", back: raw }]; }
      const markdown = cards.map((c, i) => `**Q${i + 1}:** ${c.front}\n**A:** ${c.back}`).join("\n\n");
      const saved = await saveNote({ title: askTitle, mode, markdown, cards });
      logActivity();
      appendToConversation(conversationId, `📝 Selected text (${mode})`, markdown);
      return res.json({ success: true, ...saved, markdown, cards, conversationId: conversationId ?? null });
    }

    const saved = await saveNote({ title: askTitle, mode, markdown: raw });
    logActivity();
    appendToConversation(conversationId, `📝 Selected text (${mode})`, raw);
    res.json({ success: true, ...saved, markdown: raw, conversationId: conversationId ?? null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- GET /notes ---
app.get("/notes", async (_req, res) => {
  try {
    const files = await fs.readdir(NOTES_DIR);
    const notes = await Promise.all(
      files.filter(f => f.endsWith(".md")).map(async (filename) => {
        const content = await fs.readFile(path.join(NOTES_DIR, filename), "utf-8");
        const stat = await fs.stat(path.join(NOTES_DIR, filename));
        const titleMatch    = content.match(/^title:\s*"(.+)"/m);
        const modeMatch     = content.match(/^mode:\s*"(.+)"/m);
        const courseMatch   = content.match(/^course:\s*"(.+)"/m);
        const folderIdMatch = content.match(/^folder_id:\s*"?(\d+)"?/m);
        return {
          filename,
          title:     titleMatch?.[1],
          mode:      modeMatch?.[1],
          course:    courseMatch?.[1],
          folder_id: folderIdMatch ? parseInt(folderIdMatch[1]) : undefined,
          size:      stat.size,
          modified:  stat.mtime,
        };
      })
    );
    res.json(notes.sort((a, b) => new Date(b.modified) - new Date(a.modified)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GET /notes/:filename ---
app.get("/notes/:filename", async (req, res) => {
  const { filename } = req.params;
  if ((!filename.endsWith(".md") && !filename.endsWith(".json")) || filename.includes("..")) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  try {
    const content = await fs.readFile(path.join(NOTES_DIR, filename), "utf-8");
    res.type(filename.endsWith(".json") ? "application/json" : "text/markdown").send(content);
  } catch {
    res.status(404).json({ error: "Not found" });
  }
});

// --- GET /stats ---
app.get("/stats", async (_req, res) => {
  try {
    const files = await fs.readdir(NOTES_DIR);
    const totalNotes = files.filter(f => f.endsWith(".md")).length;
    const streak = getStreak();

    const weekActivity = getActivity(7);
    const thisWeek = weekActivity.reduce((sum, r) => sum + r.count, 0);

    res.json({ totalNotes, streak, thisWeek });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GET /activity ---
app.get("/activity", (_req, res) => {
  try {
    const data = getActivity(365);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GET /conversations/active ---
app.get("/conversations/active", (_req, res) => {
  try {
    const conv = getActiveConversation();
    res.json({ id: conv.id, messages: conv.messages, title: conv.title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GET /conversations/list ---
app.get("/conversations/list", (_req, res) => {
  try {
    res.json(listConversations());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GET /conversations/:id ---
app.get("/conversations/:id", (req, res) => {
  try {
    const conv = getConversation(Number(req.params.id));
    if (!conv) return res.status(404).json({ error: "Not found" });
    res.json(conv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- POST /conversations/new ---
app.post("/conversations/new", (_req, res) => {
  try {
    const conv = createConversation();
    res.json({ id: conv.id, title: conv.title });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- POST /conversations/switch/:id ---
app.post("/conversations/switch/:id", (req, res) => {
  try {
    touchConversation(Number(req.params.id));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PATCH /conversations/:id — rename ---
app.patch("/conversations/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { title } = req.body;
  if (!title?.trim()) return res.status(400).json({ error: "title is required" });
  try {
    renameConversation(id, title.trim());
    await updateNoteFrontmatter(`conv-${id}.md`, { title: title.trim() }).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DELETE /conversations/:id ---
app.delete("/conversations/:id", (req, res) => {
  const id = Number(req.params.id);
  try {
    deleteConversation(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- POST /conversations/reorder ---
app.post("/conversations/reorder", (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "ids array required" });
  try {
    reorderConversations(ids.map(Number));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- POST /conversations/:id/merge ---
app.post("/conversations/:id/merge", (req, res) => {
  const targetId = Number(req.params.id);
  const { sourceId } = req.body;
  if (!sourceId) return res.status(400).json({ error: "sourceId required" });
  try {
    mergeConversations(targetId, Number(sourceId));
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- POST /chat — multi-turn conversation (DB-persisted) ---
app.post("/chat", async (req, res) => {
  const { message, conversationId } = req.body;
  if (!message) return res.status(400).json({ error: "message is required" });

  // Load or create conversation
  let conv = conversationId ? getConversation(conversationId) : null;
  if (!conv) conv = getActiveConversation();

  const messages = [...conv.messages, { role: "user", content: message }];
  try {
    const reply = await chat(messages);
    const updatedMessages = [...messages, { role: "assistant", content: reply }];
    // Auto-title from first user message
    const title = conv.messages.length === 0 ? message.slice(0, 60) : conv.title;
    saveConversation(conv.id, updatedMessages, title);
    await writeConversationNote({ ...conv, messages: updatedMessages, title });
    res.json({ success: true, reply, history: updatedMessages, conversationId: conv.id });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- GET /chat/history ---
app.get("/chat/history", (req, res) => {
  try {
    const convId = req.query.conversationId ? Number(req.query.conversationId) : null;
    const conv = convId ? getConversation(convId) : getActiveConversation();
    res.json(conv ? conv.messages : []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- POST /chat/clear ---
app.post("/chat/clear", (_req, res) => {
  try {
    const conv = createConversation();
    res.json({ success: true, conversationId: conv.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- POST /notes/merge — combine multiple notes into one ---
app.post("/notes/merge", async (req, res) => {
  const { filenames, title } = req.body;
  if (!Array.isArray(filenames) || filenames.length < 2) {
    return res.status(400).json({ error: "At least 2 filenames required" });
  }
  try {
    const saved = await mergeNotes(filenames, title);
    logActivity();
    res.json({ success: true, ...saved });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- PATCH /notes/:filename — update note frontmatter (course, title) ---
app.patch("/notes/:filename", async (req, res) => {
  const { filename } = req.params;
  if (!filename.endsWith(".md") || filename.includes("..")) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  const allowed = ["course", "title", "folder_id"];
  const updates = Object.fromEntries(
    Object.entries(req.body).filter(([k]) => allowed.includes(k))
  );
  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }
  try {
    await updateNoteFrontmatter(filename, updates);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DELETE /notes/:filename — permanently delete a note (and companion .cards.json) ---
app.delete("/notes/:filename", async (req, res) => {
  const { filename } = req.params;
  if (!filename.endsWith(".md") || filename.includes("..")) {
    return res.status(400).json({ error: "Invalid filename" });
  }
  try {
    await fs.unlink(path.join(NOTES_DIR, filename));
    // Also remove companion cards file if it exists
    const cardsFile = filename.replace(".md", ".cards.json");
    await fs.unlink(path.join(NOTES_DIR, cardsFile)).catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- POST /command — AI natural-language organisation command ---
app.post("/command", async (req, res) => {
  const { command } = req.body;
  if (!command) return res.status(400).json({ error: "command is required" });

  try {
    const files = await fs.readdir(NOTES_DIR);
    const notes = await Promise.all(
      files.filter((f) => f.endsWith(".md")).map(async (filename) => {
        const content = await fs.readFile(path.join(NOTES_DIR, filename), "utf-8");
        return {
          filename,
          title:  content.match(/^title:\s*"(.+)"/m)?.[1]  ?? filename,
          mode:   content.match(/^mode:\s*"(.+)"/m)?.[1]   ?? "summary",
          course: content.match(/^course:\s*"(.+)"/m)?.[1] ?? "",
          date:   content.match(/^date:\s*"(.+)"/m)?.[1]   ?? "",
        };
      })
    );
    notes.sort((a, b) => b.date.localeCompare(a.date));

    const preferences = getSetting("preferences", "");
    const raw = await processCommand(command, notes, preferences);

    let actions;
    try {
      const jsonStr = raw.replace(/^```json\n?/, "").replace(/\n?```$/, "").trim();
      actions = JSON.parse(jsonStr);
    } catch {
      return res.json({ success: true, actions: [], message: raw });
    }

    const results = [];
    for (const act of actions) {
      try {
        if (act.action === "set_course" && act.filename) {
          await updateNoteFrontmatter(act.filename, { course: act.course });
          results.push(`✓ Moved "${act.filename}" → course "${act.course}"`);
        } else if (act.action === "rename" && act.filename) {
          await updateNoteFrontmatter(act.filename, { title: act.title });
          results.push(`✓ Renamed to "${act.title}"`);
        } else if (act.action === "merge" && Array.isArray(act.filenames) && act.filenames.length >= 2) {
          const saved = await mergeNotes(act.filenames, act.title);
          logActivity();
          results.push(`✓ Merged ${act.filenames.length} notes → "${saved.filename}"`);
        } else if (act.action === "message") {
          results.push(act.text);
        }
      } catch (e) {
        results.push(`✗ Failed on ${act.filename}: ${e.message}`);
      }
    }

    res.json({ success: true, actions, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- GET /settings/preferences ---
app.get("/settings/preferences", (_req, res) => {
  res.json({ preferences: getSetting("preferences", "") });
});

// --- POST /settings/preferences ---
app.post("/settings/preferences", (req, res) => {
  const { preferences } = req.body;
  setSetting("preferences", preferences ?? "");
  res.json({ success: true });
});

// --- GET /folders ---
app.get("/folders", (_req, res) => {
  try {
    res.json(getFolderTree());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- POST /folders ---
app.post("/folders", (req, res) => {
  const { name, parentId } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });
  try {
    const folder = createFolder(name.trim(), parentId ?? null);
    res.json({ success: true, folder });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- PATCH /folders/:id ---
app.patch("/folders/:id", (req, res) => {
  const id = Number(req.params.id);
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: "name is required" });
  try {
    renameFolder(id, name.trim());
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- DELETE /folders/:id ---
app.delete("/folders/:id", (req, res) => {
  const id = Number(req.params.id);
  try {
    deleteFolder(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- GET /health ---
app.get("/health", (_req, res) => res.json({ status: "ok", port: PORT }));

// --- Static Dashboard ---
// Serve the Next.js static export. Must come after all API routes.
app.use(express.static(STATIC_DIR, { extensions: ["html"] }));
// SPA fallback: /note/* routes have no pre-built HTML for runtime filenames,
// so serve the placeholder shell and let the client-side router take over.
app.get("/note/*", (_req, res) => {
  res.sendFile(path.join(STATIC_DIR, "note/_placeholder.html"));
});

app.listen(PORT, "127.0.0.1", () => {
  const url = `http://localhost:${PORT}`;
  console.log(`LookUp Gateway running at ${url}`);
  // Auto-open the dashboard in the default browser.
  if (process.platform === "win32") exec(`start ${url}`);
  else if (process.platform === "darwin") exec(`open ${url}`);
  else exec(`xdg-open ${url}`);
});
