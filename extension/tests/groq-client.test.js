/**
 * SESSION 4 — Extension groq-client.js tests
 * Tech: Vitest + vi.mock (fetch mocked, storage.js mocked)
 *
 * groq-client.js makes all network calls via global fetch() and reads the
 * API key via Settings.getApiKey(). Both are replaced with controllable fakes.
 *
 * No real network calls are made — we test:
 *   - Request shape (correct URL, headers, body, model)
 *   - Error handling (401 bad key, 429 rate limit, network failure)
 *   - Response parsing (content extraction, JSON card parsing)
 *   - chatStream chunk assembly and delta yielding
 *   - buildSystemPrompt Hebrew language injection
 *   - verifyApiKey success / failure paths
 *   - processCommand note list truncation and serialization
 *   - Missing API key throws before any fetch call
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock storage.js ───────────────────────────────────────────────────────────
vi.mock("../storage.js", () => ({
  Settings: {
    getApiKey: vi.fn(async () => "test-api-key"),
  },
  TokenUsage: {
    add: vi.fn(async () => {}),
  },
}));

// ── Import module under test (after mock registered) ─────────────────────────
import {
  verifyApiKey,
  analyzeScreenshot,
  analyzeMulti,
  analyzeWithQuestion,
  analyzeText,
  chat,
  chatStream,
  processCommand,
  setResponseLanguage,
} from "../groq-client.js";
import { Settings, TokenUsage } from "../storage.js";

// ── Fetch helpers ─────────────────────────────────────────────────────────────
const GROQ_COMPLETIONS = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_TRANSCRIPTIONS = "https://api.groq.com/openai/v1/audio/transcriptions";

/** Build a mock successful chat completion response */
function mockCompletionResponse(content = "Mocked response", tokens = 42) {
  return {
    ok: true,
    json: async () => ({
      choices: [{ message: { content } }],
      usage: { total_tokens: tokens },
    }),
  };
}

/** Build a mock error response */
function mockErrorResponse(status, message = "Bad request") {
  return {
    ok: false,
    status,
    json: async () => ({ error: { message } }),
  };
}

/** Build an SSE stream response from an array of string deltas */
function mockStreamResponse(deltas, tokens = 10) {
  const lines = deltas.map(
    (d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`
  );
  lines.push(`data: ${JSON.stringify({ choices: [{ delta: {} }], usage: { total_tokens: tokens } })}\n\n`);
  lines.push("data: [DONE]\n\n");

  const encoder = new TextEncoder();
  const chunks = lines.map((l) => encoder.encode(l));
  let i = 0;

  const readable = new ReadableStream({
    pull(controller) {
      if (i < chunks.length) controller.enqueue(chunks[i++]);
      else controller.close();
    },
  });

  return { ok: true, body: readable, json: async () => ({}) };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Reset language to English before each test
  setResponseLanguage("en");
  // Default: key present
  Settings.getApiKey.mockResolvedValue("test-api-key");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── verifyApiKey ──────────────────────────────────────────────────────────────
describe("verifyApiKey", () => {
  it("returns { ok: true } on HTTP 200", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    expect(await verifyApiKey("gsk_good")).toEqual({ ok: true });
  });

  it("returns { ok: false, error } on HTTP 401", async () => {
    global.fetch = vi.fn(async () => mockErrorResponse(401, "Invalid API key"));
    const result = await verifyApiKey("gsk_bad");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid API key");
  });

  it("returns { ok: false, error } on network failure", async () => {
    global.fetch = vi.fn(async () => { throw new Error("Network error"); });
    const result = await verifyApiKey("any-key");
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Network error");
  });

  it("sends request to the correct Groq completions URL", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    await verifyApiKey("gsk_test");
    const [url] = global.fetch.mock.calls[0];
    expect(url).toBe(GROQ_COMPLETIONS);
  });

  it("sends Authorization Bearer header with the provided key", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    await verifyApiKey("gsk_mykey");
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer gsk_mykey");
  });

  it("uses max_tokens: 1 to keep verification cheap", async () => {
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    await verifyApiKey("gsk_test");
    const [, opts] = global.fetch.mock.calls[0];
    expect(JSON.parse(opts.body).max_tokens).toBe(1);
  });
});

// ── Missing API key ───────────────────────────────────────────────────────────
describe("Missing API key", () => {
  beforeEach(() => {
    Settings.getApiKey.mockResolvedValue(null);
    global.fetch = vi.fn(); // should never be called
  });

  it("analyzeText throws before calling fetch", async () => {
    await expect(analyzeText("hello")).rejects.toThrow(/key/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("analyzeScreenshot throws before calling fetch", async () => {
    await expect(analyzeScreenshot("base64data")).rejects.toThrow(/key/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("chat throws before calling fetch", async () => {
    await expect(chat([{ role: "user", content: "hi" }])).rejects.toThrow(/key/i);
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

// ── Error handling (429 / generic) ───────────────────────────────────────────
describe("API error handling", () => {
  it("throws friendly message on 429 rate limit", async () => {
    global.fetch = vi.fn(async () => mockErrorResponse(429, "Rate limited"));
    await expect(analyzeText("text")).rejects.toThrow(/rate.limit/i);
  });

  it("throws Groq error message on other HTTP errors", async () => {
    global.fetch = vi.fn(async () => mockErrorResponse(500, "Internal Server Error"));
    await expect(analyzeText("text")).rejects.toThrow("Internal Server Error");
  });

  it("falls back to generic message when error body is unparseable", async () => {
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 503,
      json: async () => { throw new Error("not json"); },
    }));
    await expect(analyzeText("text")).rejects.toThrow(/503/);
  });
});

// ── TokenUsage ────────────────────────────────────────────────────────────────
describe("Token usage tracking", () => {
  it("adds total_tokens after a successful chat completion", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse("result", 150));
    await analyzeText("some text");
    expect(TokenUsage.add).toHaveBeenCalledWith(150);
  });

  it("does not call TokenUsage.add when tokens field is absent", async () => {
    global.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: "ok" } }] }),
    }));
    await analyzeText("text");
    expect(TokenUsage.add).not.toHaveBeenCalled();
  });
});

// ── analyzeText ───────────────────────────────────────────────────────────────
describe("analyzeText", () => {
  it("returns content string from API response", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse("## Summary\nHello"));
    const result = await analyzeText("some text");
    expect(result).toBe("## Summary\nHello");
  });

  it("sends the correct model in the request body", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeText("text");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.model).toBe("meta-llama/llama-4-scout-17b-16e-instruct");
  });

  it("includes selectedText in the user message content", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeText("Newton's first law");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const userMsg = body.messages.find((m) => m.role === "user");
    expect(userMsg.content).toContain("Newton's first law");
  });

  it("includes a system message as the first message", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeText("text");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0].role).toBe("system");
  });

  it("quiz mode embeds correct question count in the prompt", async () => {
    // 599 chars (< 600) → quizQuestionCount = 3
    // (600 chars would be >= 600, which hits the next bucket → 4)
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeText("x".repeat(599), "quiz");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const userMsg = body.messages.find((m) => m.role === "user");
    expect(userMsg.content).toMatch(/3-question/);
  });

  it("flashcard mode embeds correct card count in the prompt", async () => {
    // 599 chars (< 600) → flashcardCount = 3
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeText("x".repeat(599), "flashcard");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const userMsg = body.messages.find((m) => m.role === "user");
    expect(userMsg.content).toMatch(/3 flashcards/);
  });

  it("unknown mode falls back to summary instruction", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeText("text", "nonexistent-mode");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const userMsg = body.messages.find((m) => m.role === "user");
    expect(userMsg.content).toMatch(/[Ss]ummariz/);
  });
});

// ── analyzeScreenshot ─────────────────────────────────────────────────────────
describe("analyzeScreenshot", () => {
  it("embeds image as data URL in the user message", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeScreenshot("abc123", "image/png", "summary");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const userMsg = body.messages.find((m) => m.role === "user");
    const imageBlock = userMsg.content.find((c) => c.type === "image_url");
    expect(imageBlock.image_url.url).toBe("data:image/png;base64,abc123");
  });

  it("uses quiz prompt for quiz mode", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeScreenshot("img", "image/png", "quiz");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const userMsg = body.messages.find((m) => m.role === "user");
    const textBlock = userMsg.content.find((c) => c.type === "text");
    expect(textBlock.text).toMatch(/quiz/i);
    expect(textBlock.text).toMatch(/2 and 8 questions/);
  });

  it("uses flashcard prompt for flashcard mode", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeScreenshot("img", "image/png", "flashcard");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const textBlock = body.messages
      .find((m) => m.role === "user").content
      .find((c) => c.type === "text");
    expect(textBlock.text).toMatch(/flashcard/i);
    expect(textBlock.text).toMatch(/JSON/);
  });

  it("defaults mode to summary when not provided", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeScreenshot("img");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const textBlock = body.messages
      .find((m) => m.role === "user").content
      .find((c) => c.type === "text");
    expect(textBlock.text).toMatch(/[Ss]ummar/);
  });
});

// ── analyzeMulti ──────────────────────────────────────────────────────────────
describe("analyzeMulti", () => {
  it("embeds all frames as image_url entries", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    const frames = [
      { base64: "frame1", mimeType: "image/png" },
      { base64: "frame2", mimeType: "image/jpeg" },
    ];
    await analyzeMulti(frames, "session");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const userContent = body.messages.find((m) => m.role === "user").content;
    const imageBlocks = userContent.filter((c) => c.type === "image_url");
    expect(imageBlocks).toHaveLength(2);
    expect(imageBlocks[0].image_url.url).toBe("data:image/png;base64,frame1");
    expect(imageBlocks[1].image_url.url).toBe("data:image/jpeg;base64,frame2");
  });

  it("uses session prompt by default", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeMulti([{ base64: "f", mimeType: "image/png" }]);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const textBlock = body.messages.find((m) => m.role === "user").content
      .find((c) => c.type === "text");
    expect(textBlock.text).toMatch(/session/i);
  });
});

// ── analyzeWithQuestion ───────────────────────────────────────────────────────
describe("analyzeWithQuestion", () => {
  it("includes the question text in the user message", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeWithQuestion("img", "image/png", "What is shown here?");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const textBlock = body.messages.find((m) => m.role === "user").content
      .find((c) => c.type === "text");
    expect(textBlock.text).toContain("What is shown here?");
  });

  it("accepts an array of images (multi-image path)", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeWithQuestion(
      [{ base64: "a", mimeType: "image/png" }, { base64: "b", mimeType: "image/png" }],
      "image/png",
      "Compare these"
    );
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const imageBlocks = body.messages.find((m) => m.role === "user").content
      .filter((c) => c.type === "image_url");
    expect(imageBlocks).toHaveLength(2);
  });
});

// ── chat ──────────────────────────────────────────────────────────────────────
describe("chat", () => {
  it("returns the assistant reply string", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse("Here is the answer."));
    const result = await chat([{ role: "user", content: "Explain recursion" }]);
    expect(result).toBe("Here is the answer.");
  });

  it("prepends a system message to the conversation history", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await chat([{ role: "user", content: "hi" }]);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0].role).toBe("system");
    expect(body.messages[1].role).toBe("user");
    expect(body.messages[1].content).toBe("hi");
  });

  it("sends full conversation history to the API", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    const history = [
      { role: "user",      content: "What is entropy?" },
      { role: "assistant", content: "Entropy is disorder." },
      { role: "user",      content: "Give an example." },
    ];
    await chat(history);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    // system + 3 history messages
    expect(body.messages).toHaveLength(4);
  });
});

// ── chatStream ────────────────────────────────────────────────────────────────
describe("chatStream", () => {
  it("yields each delta in order", async () => {
    global.fetch = vi.fn(async () => mockStreamResponse(["Hello", ", ", "world!"]));
    const deltas = [];
    for await (const delta of chatStream([{ role: "user", content: "hi" }])) {
      deltas.push(delta);
    }
    expect(deltas).toEqual(["Hello", ", ", "world!"]);
  });

  it("reassembles full response from deltas", async () => {
    global.fetch = vi.fn(async () => mockStreamResponse(["The", " answer", " is", " 42."]));
    let full = "";
    for await (const delta of chatStream([{ role: "user", content: "q" }])) {
      full += delta;
    }
    expect(full).toBe("The answer is 42.");
  });

  it("adds token count from stream usage chunk", async () => {
    global.fetch = vi.fn(async () => mockStreamResponse(["hi"], 77));
    for await (const _ of chatStream([{ role: "user", content: "q" }])) {}
    expect(TokenUsage.add).toHaveBeenCalledWith(77);
  });

  it("throws friendly message on 429 during streaming", async () => {
    global.fetch = vi.fn(async () => mockErrorResponse(429, "limit"));
    const gen = chatStream([{ role: "user", content: "q" }]);
    await expect(gen.next()).rejects.toThrow(/too many requests|rate.limit|quota/i);
  });

  it("sends stream: true in the request body", async () => {
    global.fetch = vi.fn(async () => mockStreamResponse(["ok"]));
    for await (const _ of chatStream([{ role: "user", content: "q" }])) {}
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
  });
});

// ── Hebrew language mode ──────────────────────────────────────────────────────
describe("Hebrew language mode", () => {
  it("setResponseLanguage('he') appends Hebrew instruction to system prompt", async () => {
    setResponseLanguage("he");
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeText("text");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).toMatch(/עברית/);
  });

  it("setResponseLanguage('en') uses English-only system prompt", async () => {
    setResponseLanguage("en");
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeText("text");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.messages[0].content).not.toMatch(/עברית/);
  });
});

// ── processCommand ────────────────────────────────────────────────────────────
describe("processCommand", () => {
  it("returns the raw JSON string from the API", async () => {
    const actions = '[{"action":"message","text":"done"}]';
    global.fetch = vi.fn(async () => mockCompletionResponse(actions));
    const result = await processCommand("rename last note", [], "");
    expect(result).toBe(actions);
  });

  it("truncates notes list to 60 entries", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse("[]"));
    const notes = Array.from({ length: 80 }, (_, i) => ({
      filename: `note-${i}.md`,
      title: `Note ${i}`,
      mode: "summary",
      course: "",
      createdAt: Date.now(),
    }));
    await processCommand("sort notes", notes, "");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const systemMsg = body.messages.find((m) => m.role === "system").content;
    // Exactly 60 JSON lines in the NOTES section
    const noteLines = systemMsg.match(/\{"f":"/g) ?? [];
    expect(noteLines.length).toBe(60);
  });

  it("includes command as the last user message", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse("[]"));
    await processCommand("rename this note", [], "");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    const lastMsg = body.messages[body.messages.length - 1];
    expect(lastMsg.role).toBe("user");
    expect(lastMsg.content).toBe("rename this note");
  });

  it("includes history messages between system and user command", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse("[]"));
    const history = [
      { role: "assistant", content: "Which course?" },
      { role: "user",      content: "CS101" },
    ];
    await processCommand("now rename it", [], "", history);
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    // system + 2 history + 1 user command = 4 messages
    expect(body.messages).toHaveLength(4);
    expect(body.messages[1].content).toBe("Which course?");
    expect(body.messages[3].content).toBe("now rename it");
  });

  it("uses low temperature (0.1) for deterministic command parsing", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse("[]"));
    await processCommand("cmd", [], "");
    const body = JSON.parse(global.fetch.mock.calls[0][1].body);
    expect(body.temperature).toBe(0.1);
  });
});

// ── authHeaders ───────────────────────────────────────────────────────────────
describe("authHeaders shape", () => {
  it("all non-streaming calls include Content-Type: application/json", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeText("hello");
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers["Content-Type"]).toBe("application/json");
  });

  it("all calls include Authorization: Bearer <key>", async () => {
    global.fetch = vi.fn(async () => mockCompletionResponse());
    await analyzeText("hello");
    const [, opts] = global.fetch.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer test-api-key");
  });
});
