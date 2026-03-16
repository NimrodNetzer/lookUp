/**
 * SESSION 6 — Gateway: Security & Edge Cases
 * Tech: Vitest, supertest, vi.mock (db.js, groq.js, fs, child_process)
 *
 * Tests privacy rules, CORS enforcement, input edge cases, frontmatter
 * parsing, writeConversationNote flashcard detection, and path validation.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import request from "supertest";

// ── Module mocks (must be before dynamic import) ──────────────────────────────

vi.mock("../db.js", () => ({
  logActivity:           vi.fn(),
  getActivity:           vi.fn(() => []),
  getStreak:             vi.fn(() => 0),
  getSetting:            vi.fn((k) => (k === "apiKey" ? "test-key" : null)),
  setSetting:            vi.fn(),
  getActiveConversation: vi.fn(() => ({ id: 1, title: "Test", messages: [] })),
  createConversation:    vi.fn(() => ({ id: 1, title: "New", messages: [] })),
  saveConversation:      vi.fn(),
  getConversation:       vi.fn(() => ({ id: 1, title: "Test", messages: [] })),
  listConversations:     vi.fn(() => []),
  touchConversation:     vi.fn(),
  deleteConversation:    vi.fn(),
  renameConversation:    vi.fn(),
  reorderConversations:  vi.fn(),
  mergeConversations:    vi.fn(() => ({ id: 2, title: "Merged", messages: [] })),
  getFolderTree:         vi.fn(() => []),
  createFolder:          vi.fn(() => ({ id: 1, name: "F", parentId: null })),
  renameFolder:          vi.fn(),
  deleteFolder:          vi.fn(),
  appendCommandLog:      vi.fn(),
  getCommandLog:         vi.fn(() => []),
}));

vi.mock("../groq.js", () => ({
  analyzeScreenshot:      vi.fn(async () => "## Screen"),
  analyzeMulti:           vi.fn(async () => "## Multi"),
  analyzeText:            vi.fn(async () => "## Text"),
  analyzeWithQuestion:    vi.fn(async () => "## Answer"),
  transcribeAndSummarize: vi.fn(async () => ({ transcript: "t", markdown: "## T" })),
  chat:                   vi.fn(async () => "## Chat"),
  chatStream:             vi.fn(async function* () { yield "ok"; }),
  processCommand:         vi.fn(async () => JSON.stringify({ title: "t", notes: [] })),
  resetGroqClient:        vi.fn(),
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    readdir:   vi.fn(async () => []),
    readFile:  vi.fn(async () => '---\ntitle: "Test Note"\ndate: "2024-01-01"\nmode: "summary"\n---\n\n# Content'),
    writeFile: vi.fn(async () => {}),
    unlink:    vi.fn(async () => {}),
    mkdir:     vi.fn(async () => {}),
  };
});

vi.mock("child_process", () => ({ exec: vi.fn() }));

// ── App import ────────────────────────────────────────────────────────────────

let app;
beforeEach(async () => {
  if (!app) {
    process.env.NODE_ENV = "test";
    process.env.GROQ_API_KEY = "test-key";
    const mod = await import("../index.js");
    app = mod.app;
  }
  vi.clearAllMocks();
});

// ── CORS ──────────────────────────────────────────────────────────────────────

describe("CORS policy", () => {
  it("allows chrome-extension:// origins", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "chrome-extension://abcdefg");
    expect(res.headers["access-control-allow-origin"]).toBe("chrome-extension://abcdefg");
  });

  it("allows localhost origins", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "http://localhost:3000");
    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("allows 127.0.0.1 origins", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "http://127.0.0.1:18789");
    expect(res.headers["access-control-allow-origin"]).toBe("http://127.0.0.1:18789");
  });

  it("blocks unknown external origins", async () => {
    const res = await request(app)
      .get("/health")
      .set("Origin", "https://evil.com");
    // Either no CORS header or a 500 (CORS error)
    const allowed = res.headers["access-control-allow-origin"];
    expect(allowed).toBeUndefined();
  });
});

// ── Path traversal ────────────────────────────────────────────────────────────

describe("Path traversal protection", () => {
  it("rejects URL-encoded traversal in GET /notes/:filename", async () => {
    const res = await request(app).get("/notes/..%2Fsecret.md");
    expect(res.status).toBe(400);
  });

  it("rejects URL-encoded traversal in DELETE /notes/:filename", async () => {
    const res = await request(app).delete("/notes/..%2Fsecret.md");
    expect(res.status).toBe(400);
  });

  it("rejects double-encoded traversal", async () => {
    const res = await request(app).get("/notes/..%252Fsecret.md");
    expect(res.status).toBe(400);
  });

  it("accepts a normal filename", async () => {
    const { readFile } = await import("fs/promises");
    readFile.mockResolvedValueOnce('---\ntitle: "Note"\ndate: "2024"\nmode: "summary"\n---\n\n# Body');
    const res = await request(app).get("/notes/my-note.md");
    expect([200, 404]).toContain(res.status);
  });
});

// ── Input validation — /action ─────────────────────────────────────────────────

describe("POST /action input validation", () => {
  it("returns 400 when screenshot is missing", async () => {
    const res = await request(app)
      .post("/action")
      .send({ mode: "summary" });
    expect(res.status).toBe(400);
  });

  it("returns 400 when screenshot is empty string", async () => {
    const res = await request(app)
      .post("/action")
      .send({ screenshot: "", mode: "summary" });
    expect(res.status).toBe(400);
  });

  it("accepts valid screenshot field", async () => {
    const { analyzeScreenshot } = await import("../groq.js");
    const { writeFile } = await import("fs/promises");
    analyzeScreenshot.mockResolvedValueOnce("## Result");
    writeFile.mockResolvedValueOnce(undefined);
    const res = await request(app)
      .post("/action")
      .send({ screenshot: "data:image/png;base64,abc123", mode: "summary" });
    expect([200, 201]).toContain(res.status);
  });

  it("sanitizes title with quotes in frontmatter (no injection)", async () => {
    const { analyzeScreenshot } = await import("../groq.js");
    const { writeFile } = await import("fs/promises");
    analyzeScreenshot.mockResolvedValueOnce("## Content");
    writeFile.mockResolvedValueOnce(undefined);
    const res = await request(app)
      .post("/action")
      .send({ screenshot: "data:image/png;base64,abc", mode: "summary", title: 'Evil "title"' });
    expect([200, 201]).toContain(res.status);
    const written = writeFile.mock.calls.find(c => c[0]?.endsWith?.(".md"))?.[1] ?? "";
    // Quotes must be escaped in frontmatter
    expect(written).not.toMatch(/title: "Evil "title""/);
  });
});

// ── writeConversationNote flashcard detection (replicated pure logic) ──────────
// writeConversationNote is a private function in index.js — test by replication.

function buildConversationNoteBody(conv) {
  const title = (conv.title ?? "New conversation").replace(/"/g, '\\"');
  const frontmatter = `---\ntitle: "${title}"\ndate: "2024-01-01T00:00:00.000Z"\nmode: "chat"\nconversation_id: "${conv.id}"\n---\n\n`;
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
  return frontmatter + body.trim();
}

describe("writeConversationNote flashcard detection", () => {
  it("renders flashcard JSON in assistant messages as Q&A pairs", () => {
    const cards = [{ front: "Capital of France?", back: "Paris" }];
    const written = buildConversationNoteBody({
      id: 42,
      title: "Flash test",
      messages: [
        { role: "user", content: "Make flashcards" },
        { role: "assistant", content: JSON.stringify(cards) },
      ],
    });
    expect(written).toContain("**Flashcards:**");
    expect(written).toContain("Capital of France?");
    expect(written).toContain("Paris");
  });

  it("renders plain assistant messages as-is", () => {
    const written = buildConversationNoteBody({
      id: 43,
      title: "Chat note",
      messages: [
        { role: "user", content: "Explain gravity" },
        { role: "assistant", content: "## Gravity\nGravity pulls things together." },
      ],
    });
    expect(written).toContain("## Gravity");
    expect(written).not.toContain("**Flashcards:**");
  });

  it("escapes quotes in conversation title (no frontmatter injection)", () => {
    const written = buildConversationNoteBody({
      id: 44,
      title: 'Evil "title" here',
      messages: [],
    });
    expect(written).toContain('\\"title\\"');
    // Must not have raw unescaped " inside the title value
    expect(written).not.toMatch(/title: "Evil "title" here"/);
  });

  it("labels user messages with **You:**", () => {
    const written = buildConversationNoteBody({
      id: 45,
      title: "User label test",
      messages: [{ role: "user", content: "Hello there" }],
    });
    expect(written).toContain("**You:** Hello there");
  });

  it("handles empty messages array gracefully", () => {
    const written = buildConversationNoteBody({ id: 46, title: "Empty", messages: [] });
    expect(written).toContain("---");
    expect(written).toContain('title: "Empty"');
  });

  it("uses 'New conversation' as fallback when title is null", () => {
    const written = buildConversationNoteBody({ id: 47, title: null, messages: [] });
    expect(written).toContain('title: "New conversation"');
  });
});

// ── Health endpoint ────────────────────────────────────────────────────────────

describe("GET /health", () => {
  it("returns 200 with status: ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("does not expose stack traces or internal paths", async () => {
    const res = await request(app).get("/health");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("node_modules");
    expect(body).not.toContain("Error:");
    expect(body).not.toContain("stack");
  });
});

// ── API key setup endpoint ─────────────────────────────────────────────────────

describe("POST /setup/apikey security", () => {
  it("does not echo back the API key in the response", async () => {
    const { setSetting } = await import("../db.js");
    setSetting.mockImplementation(() => {});
    const { resetGroqClient } = await import("../groq.js");

    const res = await request(app)
      .post("/setup/apikey")
      .send({ apiKey: "gsk_supersecret" });

    const body = JSON.stringify(res.body);
    expect(body).not.toContain("gsk_supersecret");
  });
});
