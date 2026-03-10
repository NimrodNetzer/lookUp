// LookUp content script — detects text selection and relays it to the side panel

let lastSent = "";

document.addEventListener("mouseup", () => {
  const selected = window.getSelection()?.toString().trim() ?? "";
  if (selected === lastSent) return;
  lastSent = selected;

  // Only relay meaningful selections (3+ chars) or explicit deselection
  if (selected.length >= 3 || selected === "") {
    chrome.runtime.sendMessage({ type: "textSelection", text: selected }, () => {
      void chrome.runtime.lastError; // suppress "no listener" errors when panel is closed
    });
  }
});
