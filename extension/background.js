// Disable auto-open on action click — we control it manually so the panel
// starts closed by default and only opens when the user clicks the icon.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
});

// Open the side panel when the toolbar icon is clicked (window-level so it
// persists across tab switches without freezing or requiring a reload)
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

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
