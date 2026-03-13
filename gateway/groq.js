import Groq from "groq-sdk";
import fs from "fs/promises";
import { createReadStream } from "fs";
import path from "path";
import os from "os";

// Lazy client — instantiated on first use so the server starts even without a key.
let _groq = null;
const groq = new Proxy({}, {
  get(_, prop) {
    if (!process.env.GROQ_API_KEY) {
      throw new Error(
        "GROQ_API_KEY is not configured.\n" +
        "Open the LookUp dashboard and paste your API key in the setup screen.\n" +
        "Get a free key at https://console.groq.com/keys"
      );
    }
    if (!_groq) _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
    return _groq[prop];
  }
});

/** Call this after updating process.env.GROQ_API_KEY so the client reinitialises. */
export function resetGroqClient() { _groq = null; }

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

  quiz: "",  // built dynamically in analyzeScreenshot after text extraction

  flashcard: ``,  // built dynamically (like quiz) after text extraction

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

/**
 * Analyze one screenshot
 */
export async function analyzeScreenshot(base64Image, mimeType = "image/png", mode = "summary") {
  let prompt = modePrompts[mode] ?? modePrompts.summary;

  // For quiz/flashcard mode: extract visible text first to compute an accurate count
  if (mode === "quiz" || mode === "flashcard") {
    const extractRes = await groq.chat.completions.create({
      model: "meta-llama/llama-4-scout-17b-16e-instruct",
      messages: [
        {
          role: "user",
          content: [
            { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
            { type: "text", text: "Extract all visible text from this image. Output only the raw text, no commentary." },
          ],
        },
      ],
      temperature: 0,
    });
    const visibleText = extractRes.choices[0].message.content ?? "";
    if (mode === "quiz") {
      const n = quizQuestionCount(visibleText);
      prompt = `Create a ${n}-question quiz based on this screenshot to test real understanding — not just memorization.\n\nFormat each question exactly like this:\n\n**Q1.** [Question]\n**Answer:** [Complete answer]\n\nInclude these question types (proportionally to question count):\n- At least one "explain why…" question\n- At least one application question (how/when would you use this?)\n- If questions ≥ 4, include a comparison question (what's the difference between X and Y?)\n- Remaining questions can test definitions or recall`;
    } else {
      const n = flashcardCount(visibleText);
      prompt = `Generate exactly ${n} flashcards from this screenshot.\nReturn ONLY a valid JSON array — no markdown fences, no explanation, just raw JSON:\n[{"front": "Question or term", "back": "Answer or definition"}]`;
    }
  }

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          { type: "text", text: prompt },
        ],
      },
    ],
    temperature: 0.4,
  });

  return response.choices[0].message.content;
}

/**
 * Analyze multiple screenshots with any mode prompt
 */
export async function analyzeMulti(frames, mode = "session") {
  const imageContent = frames.map(({ base64, mimeType = "image/png" }) => ({
    type: "image_url",
    image_url: { url: `data:${mimeType};base64,${base64}` },
  }));

  const prompt = modePrompts[mode] ?? modePrompts.session;

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [...imageContent, { type: "text", text: prompt }],
      },
    ],
    temperature: 0.4,
  });

  return response.choices[0].message.content;
}

/**
 * Answer a specific user question about a screenshot
 */
export async function analyzeWithQuestion(base64Image, mimeType = "image/png", question) {
  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "image_url", image_url: { url: `data:${mimeType};base64,${base64Image}` } },
          { type: "text", text: question },
        ],
      },
    ],
    temperature: 0.4,
  });
  return response.choices[0].message.content;
}

/**
 * Analyze selected text (no image) — for the "Ask about selection" feature
 */
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

export async function analyzeText(selectedText, mode = "summary") {
  const instructions = {
    summary: "Summarize and organize this text for a student, using your structured summary format:",
    explain: "Explain this text in depth as a patient tutor — motivate the topic, walk through concepts, use analogies, close with the key insight:",
    quiz: `Generate a ${quizQuestionCount(selectedText)}-question quiz (with answers) based on this text, testing real understanding:`,
    flashcard: `Generate exactly ${flashcardCount(selectedText)} flashcards from this text.\nReturn ONLY a valid JSON array — no markdown fences, no explanation, just raw JSON:\n[{"front": "Question or term", "back": "Answer or definition"}]`,
  };
  const instruction = instructions[mode] ?? instructions.summary;

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `${instruction}\n\n---\n\n${selectedText}` },
    ],
    temperature: 0.4,
  });

  return response.choices[0].message.content;
}

/**
 * Transcribe audio via Groq Whisper, then summarize the transcript
 */
export async function transcribeAndSummarize(audioBuffer, mode = "summary") {
  const tmpPath = path.join(os.tmpdir(), `lookup_${Date.now()}.webm`);
  await fs.writeFile(tmpPath, audioBuffer);

  let transcript = "";
  try {
    const result = await groq.audio.transcriptions.create({
      file: createReadStream(tmpPath),
      model: "whisper-large-v3-turbo",
      response_format: "text",
    });
    transcript = typeof result === "string" ? result : (result.text ?? "");
  } finally {
    await fs.unlink(tmpPath).catch(() => {});
  }

  if (!transcript.trim()) {
    return { transcript: "", markdown: "No speech detected in the recording." };
  }

  const audioN = quizQuestionCount(transcript);
  const audioPrompts = {
    summary: `${modePrompts.summary}\n\nTranscript to analyze:\n${transcript}`,
    explain: `${modePrompts.explain}\n\nTranscript to analyze:\n${transcript}`,
    quiz: `Generate a ${audioN}-question quiz (with answers) based on this transcript, testing real understanding.\n\nFormat each question exactly like this:\n\n**Q1.** [Question]\n**Answer:** [Complete answer]\n\nTranscript to analyze:\n${transcript}`,
    flashcard: `Generate exactly ${flashcardCount(transcript)} flashcards from this transcript.\nReturn ONLY a valid JSON array — no markdown fences, no explanation, just raw JSON:\n[{"front": "Question or term", "back": "Answer or definition"}]\n\nTranscript to analyze:\n${transcript}`,
  };

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: audioPrompts[mode] ?? audioPrompts.summary },
    ],
    temperature: 0.4,
  });

  return { transcript, markdown: response.choices[0].message.content };
}

/**
 * Multi-turn chat — messages is [{role:"user"|"assistant", content:string}]
 */
export async function chat(messages) {
  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      ...messages,
    ],
    temperature: 0.6,
  });
  return response.choices[0].message.content;
}

/**
 * Process a natural-language organisation command.
 * Returns a JSON string (array of action objects).
 */
export async function processCommand(command, notes, preferences) {
  const list = notes
    .slice(0, 60)
    .map(n => `{"f":"${n.filename}","t":"${n.title}","m":"${n.mode}","c":"${n.course || ""}","d":"${(n.date || "").slice(0, 10)}"}`)
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

  const response = await groq.chat.completions.create({
    model: "meta-llama/llama-4-scout-17b-16e-instruct",
    messages: [{ role: "user", content: prompt }],
    temperature: 0.1,
  });

  return response.choices[0].message.content;
}
