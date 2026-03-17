// Disable auto-open on action click — we control it manually so the panel
// starts closed by default and only opens when the user clicks the icon.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});

  // Right-click context menu on selected text
  chrome.contextMenus.create({
    id: "lookup-explain",
    title: "Explain with LookUp",
    contexts: ["selection"],
  });
});

// Open the side panel when the toolbar icon is clicked (window-level so it
// persists across tab switches without freezing or requiring a reload)
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// Right-click "Explain with LookUp" — store the selected text and open the panel
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== "lookup-explain") return;
  const text = info.selectionText?.trim();
  if (!text || !tab?.windowId) return;
  // Open panel FIRST — must be synchronous (before any await) to preserve user gesture
  chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  // Then persist the text and notify the panel
  chrome.storage.local.set({ pendingExplain: { text, ts: Date.now() } }).then(() => {
    chrome.runtime.sendMessage({ type: "pendingExplain" }).catch(() => {});
  });
});

// Cache the focused window ID so the command handler can call sidePanel.open()
// synchronously — Chrome requires no await before sidePanel.open() or it throws
// "may only be called in response to a user gesture".
let _focusedWindowId = null;
chrome.windows.onFocusChanged.addListener((id) => { if (id > 0) _focusedWindowId = id; });
chrome.tabs.onActivated.addListener(({ windowId }) => { _focusedWindowId = windowId; });

// Keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  // Alt+S — open side panel
  if (command === "open-sidepanel") {
    if (_focusedWindowId) {
      chrome.sidePanel.open({ windowId: _focusedWindowId }).catch(() => {});
    }
    return;
  }

  // Alt+Shift+C — capture current tab silently (no panel needed)
  if (command === "capture-screen") {
    // Use the cached focused window to capture immediately (preserves user gesture)
    const windowId = _focusedWindowId;
    if (!windowId) return;
    let dataUrl;
    try {
      dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: "jpeg", quality: 85 });
    } catch { return; } // restricted page (chrome://, etc.)

    // Get the tab title for labelling
    const [tab] = await chrome.tabs.query({ active: true, windowId });
    await chrome.storage.local.set({
      pendingCapture: { dataUrl, tabTitle: tab?.title ?? "", ts: Date.now() },
    });

    // Notify the panel if already open, otherwise show a Chrome notification
    const sent = await chrome.runtime.sendMessage({ type: "pendingCapture" }).catch(() => null);
    if (!sent) {
      chrome.notifications.create("lookup-capture", {
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/icon48.png"),
        title: "LookUp — Captured",
        message: "Screenshot saved. Open the panel to see the result.",
        silent: true,
      });
    }
  }
});

// ── PDF interception (disabled for now — revisit before Web Store publish) ──
// Uncomment the listener below to redirect .pdf navigations to our custom
// pdf-viewer.html (PDF.js + text layer) so text selection works in the panel.
//
// chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
//   if (changeInfo.status !== "loading") return;
//   const url = tab.url || changeInfo.url;
//   if (!url) return;
//   const viewerBase = chrome.runtime.getURL("pdf-viewer.html");
//   if (url.startsWith(viewerBase)) return;
//   if (!/^https?:\/\//i.test(url)) return;
//   if (!url.toLowerCase().includes(".pdf")) return;
//   const viewerUrl = viewerBase + "?url=" + encodeURIComponent(url);
//   chrome.tabs.update(tabId, { url: viewerUrl }).catch(() => {});
// });

// ── Background recording state ────────────────────────────────────────────────
// Tracks whether an offscreen MediaRecorder is active so the side panel can
// restore its timer UI if it is closed and reopened mid-recording.
let _recordingState = null; // { source, startTime, label } | null

async function ensureOffscreen() {
  const has = await chrome.offscreen.hasDocument().catch(() => false);
  if (!has) {
    await chrome.offscreen.createDocument({
      url: chrome.runtime.getURL("offscreen.html"),
      reasons: ["USER_MEDIA"],
      justification: "Keeps audio recording alive when the side panel is closed",
    });
  }
}

async function closeOffscreen() {
  await chrome.offscreen.closeDocument().catch(() => {});
}

// ── Message router ────────────────────────────────────────────────────────────
// Keep service worker alive so sidepanel messages don't hang.
// MV3 SWs sleep after ~30s of inactivity; sidepanel pings every 25s.
// Also relay mic permission results from the helper tab back to the sidepanel.
let _micPermissionResolvers = [];
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "keepAlive") return;
  if (msg.type === "micPermissionResult") {
    _micPermissionResolvers.forEach(fn => fn(msg));
    _micPermissionResolvers = [];
    return;
  }
  if (msg.type === "waitForMicPermission") {
    _micPermissionResolvers.push(sendResponse);
    return true; // async
  }

  // ── Recording: start ──────────────────────────────────────────────────────
  if (msg.type === "startRecording") {
    (async () => {
      try {
        let streamId = null;
        if (msg.source === "tab") {
          // Get a tab-capture stream ID consumable by the offscreen doc
          streamId = await new Promise((res, rej) => {
            chrome.tabCapture.getMediaStreamId({}, (id) => {
              if (!chrome.runtime.lastError) { res(id); return; }
              chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
                if (!tab) { rej(new Error("No active tab")); return; }
                chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (id2) => {
                  if (chrome.runtime.lastError) rej(new Error(chrome.runtime.lastError.message));
                  else res(id2);
                });
              });
            });
          });
        }
        await ensureOffscreen();
        chrome.runtime.sendMessage({ type: "offscreen:start", source: msg.source, streamId });
        _recordingState = { source: msg.source, startTime: Date.now(), label: msg.label ?? "" };
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: err.message });
      }
    })();
    return true; // async
  }

  // ── Recording: stop ───────────────────────────────────────────────────────
  if (msg.type === "stopRecording") {
    chrome.runtime.sendMessage({ type: "offscreen:stop" }).catch(() => {});
    sendResponse({ ok: true });
    return;
  }

  // ── Recording: query state ────────────────────────────────────────────────
  if (msg.type === "getRecordingState") {
    sendResponse(_recordingState);
    return;
  }

  // ── Recording: finished (from offscreen doc) ─────────────────────────────
  if (msg.type === "recordingDone") {
    _recordingState = null;
    closeOffscreen();
    // Forward to sidepanel (best-effort — panel may be closed)
    chrome.runtime.sendMessage({ type: "recordingDone" }).catch(() => {});
    return;
  }

  // ── Recording: error (from offscreen doc) ────────────────────────────────
  if (msg.type === "recordingError") {
    _recordingState = null;
    closeOffscreen();
    chrome.runtime.sendMessage({ type: "recordingError", error: msg.error }).catch(() => {});
    return;
  }
});

// Relay tab audio stream ID to the side panel.
// chrome.tabCapture.getMediaStreamId must be called from the service worker;
// the side panel then uses the returned streamId with getUserMedia.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type !== "getTabCaptureStreamId") return false;
  // Try without targetTabId first — works for the active tab without requiring
  // that the extension was previously "invoked" on that specific tab.
  chrome.tabCapture.getMediaStreamId({}, (streamId) => {
    if (!chrome.runtime.lastError) { sendResponse({ streamId }); return; }
    // Fallback: query the active tab explicitly
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (!tab) { sendResponse({ error: "No active tab" }); return; }
      chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id }, (streamId2) => {
        if (chrome.runtime.lastError) {
          sendResponse({ error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ streamId: streamId2 });
        }
      });
    });
  });
  return true; // keep channel open for async sendResponse
});
