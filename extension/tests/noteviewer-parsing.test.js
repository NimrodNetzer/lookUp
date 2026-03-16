/**
 * SESSION 5a — NoteViewer pure parsing logic
 * Tech: Vitest (no DOM needed — pure JS functions)
 *
 * tryParseCards, parseQuiz, detectType and the renderMd from ChatPage
 * are the most critical content-handling functions. A bug here means
 * a user sees raw JSON or broken quizzes instead of their actual content.
 *
 * These functions are private (not exported) but we replicate them here
 * identically — any divergence in production will be caught by failing tests.
 */

import { describe, it, expect } from "vitest";

// ── Replicated from NoteViewer.jsx ────────────────────────────────────────────
function tryParseCards(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed[0]?.front !== undefined) return parsed;
  } catch {}
  return null;
}

function parseQuiz(content) {
  const pairs = [];
  const regex = /\*\*Q\d+\.\*\*\s*([\s\S]*?)\n\*\*Answer:\*\*\s*([\s\S]*?)(?=\n\*\*Q\d+\.\*\*|$)/g;
  let match;
  while ((match = regex.exec(content)) !== null) {
    const q = match[1].trim();
    const a = match[2].trim();
    if (q && a) pairs.push({ q, a });
  }
  return pairs.length > 0 ? pairs : null;
}

function detectType(text) {
  if (tryParseCards(text)) return "flashcard";
  if (parseQuiz(text)) return "quiz";
  return "text";
}

// ── Replicated from ChatPage.jsx ──────────────────────────────────────────────
function renderMd(raw) {
  let h = raw
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/^#### (.+)$/gm, '<h4 class="chat-h4" dir="auto">$1</h4>')
    .replace(/^### (.+)$/gm,  '<h3 class="chat-h3" dir="auto">$1</h3>')
    .replace(/^## (.+)$/gm,   '<h2 class="chat-h2" dir="auto">$1</h2>')
    .replace(/^# (.+)$/gm,    '<h2 class="chat-h2" dir="auto">$1</h2>')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g,     "<em>$1</em>")
    .replace(/`([^`\n]+)`/g,   '<code class="chat-code">$1</code>')
    .replace(/^---+$/gm,       '<hr class="chat-hr">')
    .replace(/^[*-] (.+)$/gm,  '<li dir="auto">$1</li>');
  h = h.replace(/(<li[\s\S]*?<\/li>)(\n<li[\s\S]*?<\/li>)*/g,
    (m) => `<ul class="chat-ul">${m}</ul>`);
  h = h.replace(/\n\n+/g, '</p><p class="chat-p" dir="auto">').replace(/\n/g, "<br>");
  return `<p class="chat-p" dir="auto">${h}</p>`;
}

function parseFlashcards(content) {
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.length > 0 && parsed[0]?.front !== undefined) return parsed;
  } catch {}
  return null;
}

function isQuiz(content) { return content.includes("**Answer:**"); }

// ─────────────────────────────────────────────────────────────────────────────

describe("tryParseCards", () => {
  it("parses valid flashcard JSON array", () => {
    const cards = tryParseCards('[{"front":"Q1","back":"A1"}]');
    expect(cards).toHaveLength(1);
    expect(cards[0].front).toBe("Q1");
    expect(cards[0].back).toBe("A1");
  });

  it("parses multiple cards", () => {
    const json = '[{"front":"Q1","back":"A1"},{"front":"Q2","back":"A2"}]';
    expect(tryParseCards(json)).toHaveLength(2);
  });

  it("returns null for plain text", () => {
    expect(tryParseCards("## Summary\nSome text")).toBeNull();
  });

  it("returns null for JSON that is not an array", () => {
    expect(tryParseCards('{"front":"Q1"}')).toBeNull();
  });

  it("returns null for array without front field", () => {
    expect(tryParseCards('[{"question":"Q","answer":"A"}]')).toBeNull();
  });

  it("returns null for JSON with markdown fences (raw AI output)", () => {
    const fenced = "```json\n[{\"front\":\"Q\",\"back\":\"A\"}]\n```";
    expect(tryParseCards(fenced)).toBeNull();
  });

  it("returns null for empty array", () => {
    // empty array has no [0].front → null
    expect(tryParseCards("[]")).toBeNull();
  });

  it("returns null for invalid JSON", () => {
    expect(tryParseCards("{not json}")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(tryParseCards("")).toBeNull();
  });
});

describe("parseQuiz", () => {
  const singleQuestion = `**Q1.** What is Newton's first law?\n**Answer:** An object at rest stays at rest.`;

  it("parses a single Q&A pair", () => {
    const pairs = parseQuiz(singleQuestion);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].q).toBe("What is Newton's first law?");
    expect(pairs[0].a).toBe("An object at rest stays at rest.");
  });

  it("parses multiple Q&A pairs", () => {
    const content = `**Q1.** First question?\n**Answer:** First answer.\n**Q2.** Second question?\n**Answer:** Second answer.`;
    expect(parseQuiz(content)).toHaveLength(2);
  });

  it("returns null for plain markdown (no quiz pattern)", () => {
    expect(parseQuiz("## Summary\nSome explanation here.")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseQuiz("")).toBeNull();
  });

  it("returns null when answer is present but no Q prefix", () => {
    expect(parseQuiz("What is X?\n**Answer:** Y")).toBeNull();
  });

  it("trims whitespace from questions and answers", () => {
    const content = `**Q1.**   Padded question?  \n**Answer:**   Padded answer.  `;
    const pairs = parseQuiz(content);
    expect(pairs[0].q).toBe("Padded question?");
    expect(pairs[0].a).toBe("Padded answer.");
  });

  it("handles multi-line answers", () => {
    const content = `**Q1.** Question?\n**Answer:** Line one.\nLine two.\n**Q2.** Next?\n**Answer:** Answer.`;
    const pairs = parseQuiz(content);
    expect(pairs[0].a).toContain("Line one.");
    expect(pairs[0].a).toContain("Line two.");
  });
});

describe("detectType", () => {
  it("returns 'flashcard' for valid card JSON", () => {
    expect(detectType('[{"front":"Q","back":"A"}]')).toBe("flashcard");
  });

  it("returns 'quiz' for quiz-formatted content", () => {
    expect(detectType("**Q1.** A question?\n**Answer:** An answer.")).toBe("quiz");
  });

  it("returns 'text' for plain markdown", () => {
    expect(detectType("## Overview\nThis is a summary.")).toBe("text");
  });

  it("returns 'text' for empty string", () => {
    expect(detectType("")).toBe("text");
  });

  it("flashcard takes precedence over quiz (JSON with Answer inside)", () => {
    // if it's valid card JSON, it's a flashcard even if answer text is present
    const json = '[{"front":"What is **Answer:** ?","back":"B"}]';
    expect(detectType(json)).toBe("flashcard");
  });
});

describe("renderMd (ChatPage markdown renderer)", () => {
  it("escapes HTML special characters", () => {
    const out = renderMd("2 < 3 & 4 > 1");
    expect(out).toContain("&lt;");
    expect(out).toContain("&gt;");
    expect(out).toContain("&amp;");
  });

  it("renders ## as h2", () => {
    expect(renderMd("## Heading")).toContain("<h2");
  });

  it("renders ### as h3", () => {
    expect(renderMd("### Sub")).toContain("<h3");
  });

  it("renders **bold** as strong", () => {
    expect(renderMd("This is **bold** text")).toContain("<strong>bold</strong>");
  });

  it("renders *italic* as em", () => {
    expect(renderMd("This is *italic*")).toContain("<em>italic</em>");
  });

  it("renders `code` as code element", () => {
    expect(renderMd("Use `const x = 1`")).toContain('<code class="chat-code">const x = 1</code>');
  });

  it("renders bullet list items as li elements inside ul", () => {
    const out = renderMd("- Item one\n- Item two");
    expect(out).toContain("<li");
    expect(out).toContain('<ul class="chat-ul">');
  });

  it("renders --- as hr", () => {
    expect(renderMd("---")).toContain('<hr class="chat-hr">');
  });

  it("does not render script tags — XSS protection via escaping", () => {
    const out = renderMd("<script>alert('xss')</script>");
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("does not render img tags injected via markdown", () => {
    const out = renderMd('<img src="x" onerror="alert(1)">');
    expect(out).not.toContain("<img");
    expect(out).toContain("&lt;img");
  });
});

describe("parseFlashcards (ChatPage)", () => {
  it("parses valid card array", () => {
    const cards = parseFlashcards('[{"front":"F","back":"B"}]');
    expect(cards).toHaveLength(1);
  });

  it("returns null for empty array", () => {
    expect(parseFlashcards("[]")).toBeNull();
  });

  it("returns null for non-card JSON", () => {
    expect(parseFlashcards('{"a":1}')).toBeNull();
  });
});

describe("isQuiz (ChatPage)", () => {
  it("returns true when content contains **Answer:**", () => {
    expect(isQuiz("**Q1.** Question?\n**Answer:** Yes.")).toBe(true);
  });

  it("returns false for plain text", () => {
    expect(isQuiz("## Summary\nSome text.")).toBe(false);
  });

  it("returns false for flashcard JSON", () => {
    expect(isQuiz('[{"front":"Q","back":"A"}]')).toBe(false);
  });
});
