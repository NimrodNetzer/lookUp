document.getElementById("btn").addEventListener("click", () => {
  document.getElementById("btn").disabled = true;
  document.getElementById("status").textContent = "Waiting for your response…";
  navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    .then(stream => {
      stream.getTracks().forEach(t => t.stop());
      document.getElementById("status").textContent = "✓ Access granted! You can close this tab.";
      chrome.runtime.sendMessage({ type: "micPermissionResult", granted: true });
      setTimeout(() => window.close(), 800);
    })
    .catch(err => {
      document.getElementById("status").textContent = "Blocked. Enable mic in Chrome settings.";
      document.getElementById("btn").disabled = false;
      chrome.runtime.sendMessage({ type: "micPermissionResult", granted: false, error: err.message });
    });
});
