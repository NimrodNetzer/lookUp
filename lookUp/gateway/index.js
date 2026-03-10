import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs/promises";
import path from "path";
import { analyzeScreenshot, analyzeSession, analyzeText, transcribeAndSummarize } from "./groq.js";
import { logActivity, getActivity, getStreak } from "./db.js";

const app = express();
const PORT = process.env.PORT || 18789;
const NOTES_DIR = path.resolve("../notes");

app.use(cors({
  origin: (origin, cb) => {
    const allowed = [/^chrome-extension:\/\//, /^http:\/\/localhost/, /^http:\/\/127\.0\.0\.1/];
    if (!origin || allowed.some((r) => r.test(origin))) return cb(null, true);
    cb(new Error("Not allowed by CORS"));
  },
}));

app.use(express.json({ limit: "50mb" }));
await fs.mkdir(NOTES_DIR, { recursive: true });

// --- Helpers ---
function makeTimestamp() { return new Date().toISOString().replace(/[:.]/g, "-"); }
function makeSlug(str) { return str.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, ""); }

async function saveNote({ title, mode, markdown, cards }) {
  const ts = makeTimestamp();
  const name = title ? makeSlug(title) : mode;
  const filename = `${ts}_${name}.md`;
  const frontmatter = `---\ntitle: "${title ?? mode}"\ndate: "${new Date().toISOString()}"\nmode: "${mode}"\n---\n\n`;
  await fs.writeFile(path.join(NOTES_DIR, filename), frontmatter + markdown, "utf-8");

  if (cards) {
    const cardsFile = `${ts}_${name}.cards.json`;
    await fs.writeFile(path.join(NOTES_DIR, cardsFile), JSON.stringify(cards, null, 2), "utf-8");
    return { filename, cardsFile };
  }
  return { filename };
}

// --- POST /action — single screenshot ---
app.post("/action", async (req, res) => {
  const { screenshot, mimeType = "image/png", mode = "summary", title } = req.body;
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
      const saved = await saveNote({ title, mode, markdown, cards });
      logActivity();
      return res.json({ success: true, ...saved, markdown, cards });
    }

    const saved = await saveNote({ title, mode, markdown: raw });
    logActivity();
    res.json({ success: true, ...saved, markdown: raw });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /session — multi-slide session ---
app.post("/session", async (req, res) => {
  const { frames, title } = req.body;
  if (!Array.isArray(frames) || frames.length === 0) {
    return res.status(400).json({ error: "frames array is required" });
  }

  try {
    const markdown = await analyzeSession(frames);
    const saved = await saveNote({ title: title ?? `Session (${frames.length} slides)`, mode: "session", markdown });
    logActivity();
    res.json({ success: true, ...saved, markdown });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /transcribe — audio capture ---
app.post("/transcribe", async (req, res) => {
  const { audio, mode = "summary", title } = req.body;
  if (!audio) return res.status(400).json({ error: "audio (base64) is required" });

  try {
    const buffer = Buffer.from(audio, "base64");
    const { transcript, markdown } = await transcribeAndSummarize(buffer, mode);
    const saved = await saveNote({ title: title ?? "Audio recording", mode: `audio-${mode}`, markdown });
    logActivity();
    res.json({ success: true, ...saved, transcript, markdown });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// --- POST /ask — text selection query (no screenshot) ---
app.post("/ask", async (req, res) => {
  const { selectedText, mode = "summary", title } = req.body;
  if (!selectedText) return res.status(400).json({ error: "selectedText is required" });

  try {
    const markdown = await analyzeText(selectedText, mode);
    const saved = await saveNote({ title: title ?? "Selected text", mode, markdown });
    logActivity();
    res.json({ success: true, ...saved, markdown });
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
        const titleMatch = content.match(/^title:\s*"(.+)"/m);
        const modeMatch = content.match(/^mode:\s*"(.+)"/m);
        return { filename, title: titleMatch?.[1], mode: modeMatch?.[1], size: stat.size, modified: stat.mtime };
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

// --- GET /health ---
app.get("/health", (_req, res) => res.json({ status: "ok", port: PORT }));

app.listen(PORT, "127.0.0.1", () => {
  console.log(`LookUp Gateway running at http://127.0.0.1:${PORT}`);
});
