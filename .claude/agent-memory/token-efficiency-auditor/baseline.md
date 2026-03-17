# Token Efficiency Audit Baseline
**Date:** 2026-03-17 (updated Token Bar Reliability section: 2026-03-17)
**Audited by:** token-efficiency-auditor agent

## Files Audited
- `extension/groq-client.js`
- `extension/src/ChatPage.jsx`
- `extension/storage.js`

---

## Prompt Token Counts (post-fix baseline)

| Prompt | Chars | ~Tokens | Status |
|---|---|---|---|
| SYSTEM_PROMPT | 374 | 94 | GOOD |
| modePrompts.summary | 151 | 38 | GOOD |
| modePrompts.explain | 403 | 101 | ACCEPTABLE |
| modePrompts.session | 381 | 95 | GOOD |
| quiz (screenshot) — **fixed** | ~230 | 57 | GOOD |
| flashcard (screenshot) | 191 | 48 | GOOD |
| quiz (audio) — **fixed** | ~290 | 72 | GOOD |
| processCommand static part | 1187 | ~297 | ACCEPTABLE |
| buildModePrefix.summary | 93 | 23 | GOOD |
| buildModePrefix.explain | 148 | 37 | GOOD |
| buildModePrefix.quiz | 114 | 29 | GOOD |
| buildModePrefix.flashcard | 113 | 28 | GOOD |

---

## Fixes Applied (this audit)

### 1. Quiz screenshot prompt — ~88 tokens saved per call
**File:** `extension/groq-client.js`
Removed the verbose "Include these question types" block (4 bullet points + IMPORTANT footer).
Replaced with a single compact instruction line. Meaning unchanged — model still mixes question types.

### 2. Audio quiz prompt — ~15 tokens saved per call
**File:** `extension/groq-client.js`
Same pattern as screenshot quiz: removed redundant "Format each question exactly like this" header
and IMPORTANT footer. Condensed to one-line format spec.

### 3. processCommand — bounded output with max_tokens: 1000
**File:** `extension/groq-client.js`
Added `max_tokens: 1000` to processCommand's chatCompletion call.
JSON action arrays for up to 60 notes fit comfortably within 1000 tokens.
Prevents runaway output if model hallucinates prose instead of JSON.

### 4. `chatCompletion()` now accepts optional max_tokens parameter
**File:** `extension/groq-client.js`
Updated signature: `chatCompletion(key, messages, temperature = 0.4, max_tokens = undefined)`
Only included in request body when explicitly set. No change to existing callers that omit it.

### 5. Chat history trimming — up to thousands of tokens saved per call
**File:** `extension/src/ChatPage.jsx`
Added `const recentHistory = prevMessages.slice(-20)` before API calls.
Caps conversation context at 20 messages (10 turns) for both text and image-rich paths.
With avg 200 tokens/message, a 50-message conversation previously sent ~10,000 tokens of
history; now it sends at most ~4,000 tokens.

---

## Issues NOT Fixed (accepted)

| Issue | Reason |
|---|---|
| No max_tokens on analyzeScreenshot/analyzeText | Study summaries/explanations are legitimately long; capping would truncate useful output |
| Hebrew suffix repeated inline 4+ times | Only sent when lang=he; 8 tokens each, negligible |
| modePrompts duplicated between groq-client.js and ChatPage.jsx (buildModePrefix) | They serve different call paths and differ in wording; not true duplication |
| Messages.listByConversation loads all history | Storage layer is correct; trimming is rightly done at the call site (ChatPage) |

---

## Architecture Notes

- **No max_tokens on streaming chat:** chatCompletionStream does not accept max_tokens.
  Could be added in a future audit if costs become a concern. Chat responses are expected
  to be conversational length (100–400 tokens typically).
- **processCommand note list:** already sliced to 60 notes with compact JSON format.
  At 60 notes * ~80 chars = ~4800 chars = ~1200 tokens in the dynamic list section.
  This is the most expensive dynamic portion of any prompt.
- **Conversation history in ChatPage:** now trimmed to last 20 messages. The full history
  is still persisted in IndexedDB and displayed in the UI — only the API call is trimmed.

---

## Section 8 — Token Bar Reliability Audit (2026-03-17)

### Results Table

| Check | Finding | Status |
|---|---|---|
| analyzeScreenshot calls TokenUsage.add() | Routes through chatCompletion() which calls add() | PASS |
| analyzeMulti calls TokenUsage.add() | Routes through chatCompletion() | PASS |
| analyzeWithQuestion calls TokenUsage.add() | Routes through chatCompletion() | PASS |
| analyzeWithQuestionStream calls TokenUsage.add() | Routes through chatCompletionStream() — captured from final usage chunk via stream_options | PASS |
| analyzeText calls TokenUsage.add() | Routes through chatCompletion() | PASS |
| transcribeAndSummarize — chat completion counted | Routes through chatCompletion() | PASS |
| transcribeAndSummarize — Whisper call counted | Whisper returns plain text, no token metadata in response — not counted | ACCEPTED (Groq's Whisper endpoint provides no token usage field) |
| chat (non-streaming) calls TokenUsage.add() | Routes through chatCompletion() | PASS |
| chatStream calls TokenUsage.add() | chatCompletionStream() reads usage from final SSE chunk (stream_options.include_usage: true) | PASS |
| chatStreamRich calls TokenUsage.add() | Routes through chatCompletionStream() — same as chatStream | PASS |
| processCommand calls TokenUsage.add() | Routes through chatCompletion() | PASS |
| verifyApiKey skips TokenUsage.add() | Intentional — max_tokens:1 test call, negligible | ACCEPTED |
| Storage key and persistence | Key: "tokenUsage", object: {date, tokens} in chrome.storage.local — survives panel close | PASS |
| Double-count risk | TokenUsage.add() reads current value from storage before writing — race possible if two calls overlap, but all callers are sequential in practice | PASS |
| Reset basis | new Date().toDateString() — LOCAL midnight, consistent with countdown display | PASS |
| Countdown ticks live | FIXED — was static snapshot on open; now a setInterval(60s) updates hint while dropdown is open | FIXED |
| After reset, count goes to 0 | TokenUsage.get() compares date string — returns 0 on date mismatch | PASS |
| Timezone consistency | Both reset calc and countdown use local time — consistent | PASS |
| refreshUsageDisplay() after screenshot capture | Called at lines 1241, 1439 | PASS |
| refreshUsageDisplay() after text capture | Called at line 1281, 1514 | PASS |
| refreshUsageDisplay() after multi-page | Called at line 1575 | PASS |
| refreshUsageDisplay() after audio finish | Called at line 1805 | PASS |
| refreshUsageDisplay() after chat send | Called at line 602 (covers chatStream and analyzeWithQuestionStream paths) | PASS |
| refreshUsageDisplay() after processCommand | processCommand is in CommandChat.jsx (Dashboard React page) — no #usageCount DOM element there; token bar only exists in sidepanel.html — NOT a gap | N/A |
| DAILY_TOKEN_LIMIT value | 500_000 — matches Groq free tier (500k tokens/day) | PASS |
| Progress bar % calculation | pct = tokens / 500_000, clamped to 1 | PASS |
| Bar color thresholds | warn at 70%, crit at 90%, upgrade prompt at 85% | PASS |

### Fix Applied

**Live countdown interval** — `extension/sidepanel.js`

The "Resets in Xh Xm" hint was computed once when the dropdown opened and never updated. If a user left the dropdown open for >1 minute the timer would be stale.

Fix: Added `_usageCountdownInterval` module-level variable, `_updateResetHint()` sync function, and `_stopUsageCountdown()` helper. When the info dropdown opens, a `setInterval(_updateResetHint, 60_000)` starts. It is cleared on close (via infoBtn toggle-off, moreBtn click, or document click). The `usageResetHint` update was also extracted out of `refreshUsageDisplay()` into `_updateResetHint()` so it can be called independently by the interval without triggering an async storage read every minute.

---

## Token Benchmarks

- System prompt: <300 = good, 300–600 = acceptable, >600 = fix
- Mode prompts: <100 = good, >200 = fix
- Total per request (system + history + user): <6000 = good, >10000 = expensive
