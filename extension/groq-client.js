/**
 * groq-client.js — Direct Groq API calls from the extension.
 *
 * No Node.js SDK, no temp files — pure fetch() to api.groq.com.
 * API key is loaded from chrome.storage via Settings.getApiKey().
 *
 * Public API mirrors the functions the gateway used to expose:
 *   analyzeScreenshot(base64, mimeType, mode) → string (markdown)
 *   analyzeMulti(frames, mode)                → string (markdown)
 *   analyzeWithQuestion(base64, mimeType, q)  → string (markdown)
 *   analyzeText(text, mode)                   → string (markdown)
 *   transcribeAndSummarize(audioBlob, mode)   → { transcript, markdown }
 *   chat(messages)                            → string
 *   chatStream(messages)                      → AsyncGenerator<string>
 *   processCommand(command, notes, prefs)      → string (JSON)
 *   verifyApiKey(key)                         → { ok, error? }
 */

import { Settings } from "./storage.js";

const GROQ_API = "https://api.groq.com/openai/v1";
const VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct";
const AUDIO_MODEL = "whisper-large-v3-turbo";

// ─── Language setting ─────────────────────────────────────────────────────────
let _responseLanguage = "en";
export function setResponseLanguage(lang) { _responseLanguage = lang; }

function buildSystemPrompt() {
  if (_responseLanguage === "he") {
    return SYSTEM_PROMPT + "\n\nIMPORTANT: Respond entirely in Hebrew (עברית). All explanations, headings, bullet points, and text must be in Hebrew only.";
  }
  return SYSTEM_PROMPT;
}

// ─── Auth helper ─────────────────────────────────────────────────────────────

async function getKey() {
  const key = await Settings.getApiKey();
  if (!key) throw new Error("Groq API key not configured. Open LookUp settings to add your key.");
  return key;
}

function authHeaders(key) {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

// ─── Prompts (identical to gateway/groq.js) ──────────────────────────────────

const SYSTEM_PROMPT = `You are LookUp — a personal Study Sensei helping students understand academic content.

STRICT PRIVACY RULES — follow unconditionally:
- If you detect passwords, credit card numbers, bank details, SSNs, or any credentials, respond ONLY with: "I noticed sensitive information on screen. Please hide it before using LookUp."
- Never repeat, summarize, or reference any sensitive data.

FORMATTING RULES:
- Use GitHub-flavored Markdown.
- Mathematical expressions: inline $...$ and block $$...$$
- Diagrams/flows/relationships: Mermaid.js code blocks (\`\`\`mermaid)
- Bold key terms with **term**.`;

const modePrompts = {
  summary: `Analyze this screenshot and produce a concise structured study summary.

Output exactly this structure (omit any section that isn't applicable):

## Overview
One paragraph stating what this is about and why it matters.

## Key Concepts
- **Term or concept**: Clear, brief explanation
(Include 4–8 bullet points covering the most important ideas)

`,

  explain: `You are a patient, engaging tutor. A student shared this screenshot and asked "Can you explain this to me?"

Your explanation must:
1. Open with **why this topic exists** — the real-world motivation or problem it solves (1 short paragraph)
2. Walk through each concept in logical order — plain language first, technical terms second
3. For any formula or algorithm — describe what each part *does* in plain English before showing math
4. Give a concrete real-world analogy for the most abstract concept
5. Close with: **The key insight:** [one sentence capturing the essence]

Write conversationally, like a knowledgeable friend explaining over coffee. Use headers only for major topic shifts — this should read like a spoken explanation, not a textbook.`,

  session: `These are multiple slides from the same lecture. Produce one unified study summary.

## Session Overview
What this lecture session covers (1 paragraph).

## Core Topics Covered
For each major topic across the slides:
### [Topic Name]
- Key points
- Formulas if present (LaTeX)

## How the Concepts Connect
Explain the narrative arc — how ideas build on each other across the session.

## Study Questions
3–5 questions spanning the full session.`,
};

function flashcardCount(text) {
  const len = text.trim().length;
  if (len < 250)  return 2;
  if (len < 600)  return 3;
  if (len < 1100) return 4;
  if (len < 1700) return 5;
  if (len < 2800) return 6;
  if (len < 4000) return 7;
  return 8;
}

function quizQuestionCount(text) {
  const len = text.trim().length;
  if (len < 250)  return 2;
  if (len < 600)  return 3;
  if (len < 1100) return 4;
  if (len < 1700) return 5;
  if (len < 2800) return 6;
  if (len < 4000) return 7;
  return 8;
}

// ─── Core fetch helpers ───────────────────────────────────────────────────────

async function chatCompletion(key, messages, temperature = 0.4) {
  const res = await fetch(`${GROQ_API}/chat/completions`, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify({ model: VISION_MODEL, messages, temperature }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Groq API error ${res.status}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

async function* chatCompletionStream(key, messages, temperature = 0.6) {
  const res = await fetch(`${GROQ_API}/chat/completions`, {
    method: "POST",
    headers: authHeaders(key),
    body: JSON.stringify({ model: VISION_MODEL, messages, temperature, stream: true }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Groq API error ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop(); // keep incomplete line
    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const data = line.slice(6).trim();
      if (data === "[DONE]") return;
      try {
        const chunk = JSON.parse(data);
        const delta = chunk.choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch {}
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Verify an API key by making a cheap test call.
 * Returns { ok: true } or { ok: false, error: string }
 */
export async function verifyApiKey(key) {
  try {
    const res = await fetch(`${GROQ_API}/chat/completions`, {
      method: "POST",
      headers: authHeaders(key),
      body: JSON.stringify({
        model: VISION_MODEL,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 1,
      }),
    });
    if (res.ok) return { ok: true };
    const err = await res.json().catch(() => ({}));
    return { ok: false, error: err.error?.message ?? `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

/**
 * Analyze a single screenshot.
 * base64Image: base64-encoded image string (no data: prefix)
 * mimeType: "image/png" | "image/jpeg" | "image/webp"
 * mode: "summary" | "explain" | "quiz" | "flashcard"
 */
export async function analyzeScreenshot(base64Image, mimeType = "image/png", mode = "summary") {
  const key = await getKey();
  const imageUrl = `data:${mimeType};base64,${base64Image}`;

  let prompt = modePrompts[mode] ?? modePrompts.summary;

  // For quiz/flashcard: extract text first to compute accurate count
  if (mode === "quiz" || mode === "flashcard") {
    const visibleText = await chatCompletion(key, [
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: imageUrl } },
          { type: "text", text: "Extract all visible text from this image. Output only the raw text, no commentary." },
        ],
      },
    ], 0);

    if (mode === "quiz") {
      const n = quizQuestionCount(visibleText);
      const langNote = _responseLanguage === "he" ? "\n\nכתוב את כל השאלות והתשובות בעברית." : "";
      prompt = `Create a ${n}-question quiz based on this screenshot to test real understanding — not just memorization.\n\nFormat each question exactly like this:\n\n**Q1.** [Question]\n**Answer:** [Answer in 5–60 words — concise but complete]\n\nInclude these question types (proportionally to question count):\n- At least one "explain why…" question\n- At least one application question (how/when would you use this?)\n- If questions ≥ 4, include a comparison question (what's the difference between X and Y?)\n- Remaining questions can test definitions or recall\n\nIMPORTANT: Keep every answer between 5 and 60 words. No lengthy paragraphs.${langNote}`;
    } else {
      const n = flashcardCount(visibleText);
      prompt = `Generate exactly ${n} flashcards from this screenshot.\nReturn ONLY a valid JSON array — no markdown fences, no explanation, just raw JSON:\n[{"front": "Question or term", "back": "Answer or definition"}]`;
    }
  }

  return chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageUrl } },
        { type: "text", text: prompt },
      ],
    },
  ]);
}

/**
 * Analyze multiple screenshots together (session / multi-page mode).
 * frames: [{ base64: string, mimeType?: string }]
 */
export async function analyzeMulti(frames, mode = "session") {
  const key = await getKey();
  const imageContent = frames.map(({ base64, mimeType = "image/png" }) => ({
    type: "image_url",
    image_url: { url: `data:${mimeType};base64,${base64}` },
  }));
  const prompt = modePrompts[mode] ?? modePrompts.session;

  return chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: [...imageContent, { type: "text", text: prompt }] },
  ]);
}

/**
 * Answer a specific user question about one or more screenshots/images.
 * Accepts a single image (legacy) or an array of { base64, mimeType } objects.
 */
export async function analyzeWithQuestion(base64Image, mimeType = "image/png", question) {
  const key = await getKey();
  const images = Array.isArray(base64Image)
    ? base64Image
    : [{ base64: base64Image, mimeType }];
  const imageContent = images.map(img => ({
    type: "image_url",
    image_url: { url: `data:${img.mimeType};base64,${img.base64}` },
  }));
  return chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    {
      role: "user",
      content: [...imageContent, { type: "text", text: question }],
    },
  ]);
}

/**
 * Analyze selected text (no image).
 */
export async function analyzeText(selectedText, mode = "summary") {
  const key = await getKey();
  const langNote = _responseLanguage === "he" ? " כתוב את כל השאלות והתשובות בעברית." : "";
  const instructions = {
    summary:   "Summarize and organize this text for a student, using your structured summary format:",
    explain:   "Explain this text in depth as a patient tutor — motivate the topic, walk through concepts, use analogies, close with the key insight:",
    quiz:      `Generate a ${quizQuestionCount(selectedText)}-question quiz based on this text, testing real understanding. Format: **Q1.** [Question]\\n**Answer:** [5–60 words — concise but complete]. No lengthy paragraphs.${langNote}`,
    flashcard: `Generate exactly ${flashcardCount(selectedText)} flashcards from this text.\nReturn ONLY a valid JSON array — no markdown fences, no explanation, just raw JSON:\n[{"front": "Question or term", "back": "Answer or definition"}]`,
  };
  const instruction = instructions[mode] ?? instructions.summary;

  return chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: `${instruction}\n\n---\n\n${selectedText}` },
  ]);
}

/**
 * Transcribe audio then summarize/analyze the transcript.
 * audioBlob: a Blob (webm/ogg/mp4 — whatever MediaRecorder produces)
 * mode: "summary" | "explain" | "quiz" | "flashcard"
 * Returns { transcript: string, markdown: string }
 */
export async function transcribeAndSummarize(audioBlob, mode = "summary", userNote = "") {
  const key = await getKey();

  // Whisper via multipart/form-data — no temp file needed in the browser
  const form = new FormData();
  form.append("file", audioBlob, "audio.webm");
  form.append("model", AUDIO_MODEL);
  form.append("response_format", "text");

  const transcribeRes = await fetch(`${GROQ_API}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` }, // no Content-Type — browser sets boundary automatically
    body: form,
  });

  if (!transcribeRes.ok) {
    const err = await transcribeRes.json().catch(() => ({}));
    throw new Error(err.error?.message ?? `Transcription error ${transcribeRes.status}`);
  }

  const transcript = (await transcribeRes.text()).trim();

  if (!transcript) {
    return { transcript: "", markdown: "No speech detected in the recording." };
  }

  const n = quizQuestionCount(transcript);
  const noteCtx = userNote ? `\n\nUser's instruction: "${userNote}"` : "";
  const langNote = _responseLanguage === "he" ? "\n\nכתוב את כל השאלות והתשובות בעברית." : "";
  const audioPrompts = {
    summary:   `${modePrompts.summary}${noteCtx}\n\nTranscript to analyze:\n${transcript}`,
    explain:   `${modePrompts.explain}${noteCtx}\n\nTranscript to analyze:\n${transcript}`,
    quiz:      `Generate a ${n}-question quiz based on this transcript, testing real understanding.\n\nFormat each question exactly like this:\n\n**Q1.** [Question]\n**Answer:** [5–60 words — concise but complete]\n\nIMPORTANT: Keep every answer between 5 and 60 words.${langNote}${noteCtx}\n\nTranscript to analyze:\n${transcript}`,
    flashcard: `Generate exactly ${flashcardCount(transcript)} flashcards from this transcript.\nReturn ONLY a valid JSON array — no markdown fences, no explanation, just raw JSON:\n[{"front": "Question or term", "back": "Answer or definition"}]${noteCtx}\n\nTranscript to analyze:\n${transcript}`,
  };

  const markdown = await chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: audioPrompts[mode] ?? audioPrompts.summary },
  ]);

  return { transcript, markdown };
}

/**
 * Multi-turn chat (non-streaming).
 * messages: [{ role: "user"|"assistant", content: string }]
 */
export async function chat(messages) {
  const key = await getKey();
  return chatCompletion(key, [
    { role: "system", content: buildSystemPrompt() },
    ...messages,
  ], 0.6);
}

/**
 * Multi-turn chat with streaming.
 * Returns an AsyncGenerator that yields string deltas.
 *
 * Usage:
 *   for await (const delta of chatStream(messages)) {
 *     ui.append(delta);
 *   }
 */
export async function* chatStream(messages) {
  const key = await getKey();
  yield* chatCompletionStream(key, [
    { role: "system", content: buildSystemPrompt() },
    ...messages,
  ]);
}

/**
 * Process a natural-language organisation command.
 * Returns a JSON string (array of action objects) — same format as gateway.
 */
export async function processCommand(command, notes, preferences) {
  const key = await getKey();

  const list = notes
    .slice(0, 60)
    .map(n => `{"f":"${n.filename}","t":"${n.title}","m":"${n.type ?? n.mode}","c":"${n.course || ""}","d":"${new Date(n.createdAt).toISOString().slice(0, 10)}"}`)
    .join("\n");

  const prompt = `You manage a student's LookUp study notes. Execute the command below by returning a JSON array of actions.

NOTES (newest first):
${list}

USER PREFERENCES:
${preferences || "none"}

COMMAND: "${command}"

ACTION TYPES (return as JSON array, pick what applies):
{"action":"set_course","filename":"exact_filename.md","course":"Course Name"}
{"action":"rename","filename":"exact_filename.md","title":"New Title"}
{"action":"merge","filenames":["file1.md","file2.md"],"title":"Combined Note Title"}
{"action":"message","text":"plain-English explanation if nothing to do or command is unclear"}

RULES:
- Use ONLY exact filenames from the list above
- Course names should be title-cased clean strings, e.g. "Operating Systems"
- For "last N captures" use the N most recent filenames
- Apply user preferences (e.g. prefix rules) when renaming
- For merge: include at least 2 filenames; pick a meaningful combined title
- Return ONLY a valid JSON array, no markdown fences, no extra text

JSON array:`;

  return chatCompletion(key, [{ role: "user", content: prompt }], 0.1);
}
