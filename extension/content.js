// LookUp content script — detects text selection and relays it to the side panel

// Strict guard: some pages (e.g. Gemini) define a partial chrome.runtime object
// whose property accessors can throw — wrap everything in try-catch.
let _hasSendMessage = false;
try { _hasSendMessage = typeof chrome?.runtime?.sendMessage === "function"; } catch { /* ignore */ }

if (_hasSendMessage) {
  let lastSent = "";
  let debounceTimer = null;
  let alive = true;

  function hasSendMessage() {
    try { return typeof chrome?.runtime?.sendMessage === "function"; } catch { return false; }
  }

  function relay(text) {
    if (!alive) return;
    // Re-check each call — runtime can be invalidated after init
    if (!hasSendMessage()) { alive = false; return; }
    try {
      chrome.runtime.sendMessage({ type: "textSelection", text }, () => {
        try { void chrome.runtime?.lastError; } catch { alive = false; }
      });
    } catch {
      alive = false;
    }
  }

  document.addEventListener("selectionchange", () => {
    if (!alive) return;
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (!alive) return;
      if (!hasSendMessage()) { alive = false; return; }
      let selected = "";
      try { selected = window.getSelection()?.toString().trim() ?? ""; } catch { return; }
      if (selected === lastSent) return;
      lastSent = selected;
      if (selected.length >= 3 || selected === "") relay(selected);
    }, 250);
  });
}
