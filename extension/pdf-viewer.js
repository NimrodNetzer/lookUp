// LookUp PDF Viewer — powered by PDF.js
// Renders PDF as canvas + text layer so window.getSelection() works,
// which lets content.js relay selected text to the side panel.

const WORKER_SRC = chrome.runtime.getURL("vendor/pdf.worker.min.js");
pdfjsLib.GlobalWorkerOptions.workerSrc = WORKER_SRC;

const container   = document.getElementById("viewerContainer");
const loadingMsg  = document.getElementById("loadingMsg");
const errorMsg    = document.getElementById("errorMsg");
const pageInfo    = document.getElementById("pageInfo");
const prevBtn     = document.getElementById("prevBtn");
const nextBtn     = document.getElementById("nextBtn");
const zoomSelect  = document.getElementById("zoomSelect");
const filenameEl  = document.getElementById("filename");

// --- Read URL param ---
const params  = new URLSearchParams(location.search);
const pdfUrl  = params.get("url");

if (!pdfUrl) {
  loadingMsg.style.display = "none";
  errorMsg.style.display   = "block";
  errorMsg.textContent     = "No PDF URL provided.";
  throw new Error("No PDF URL");
}

// Show filename in toolbar
try {
  filenameEl.textContent = decodeURIComponent(pdfUrl.split("/").pop().split("?")[0]);
} catch { /* ignore */ }

let pdfDoc      = null;
let currentPage = 1;
let scale       = parseFloat(zoomSelect.value);
let rendering   = false;
let pendingPage = null;

// --- Render all pages ---
async function renderAll() {
  if (rendering) { pendingPage = currentPage; return; }
  rendering = true;
  container.innerHTML = "";
  loadingMsg.style.display = "none";

  const total = pdfDoc.numPages;
  pageInfo.textContent = `${currentPage} / ${total}`;
  prevBtn.disabled = currentPage <= 1;
  nextBtn.disabled = currentPage >= total;

  // Render a window of pages: current ± 2, for fast navigation
  const first = Math.max(1, currentPage - 1);
  const last  = Math.min(total, currentPage + 2);

  for (let i = first; i <= last; i++) {
    const page    = await pdfDoc.getPage(i);
    const viewport = page.getViewport({ scale });

    const wrapper = document.createElement("div");
    wrapper.className = "page-wrapper";
    wrapper.dataset.pageNum = i;
    wrapper.style.width  = viewport.width  + "px";
    wrapper.style.height = viewport.height + "px";

    const canvas  = document.createElement("canvas");
    canvas.width  = viewport.width;
    canvas.height = viewport.height;
    wrapper.appendChild(canvas);

    // Text layer overlay — this is what makes selection work
    const textLayerDiv = document.createElement("div");
    textLayerDiv.className = "textLayer";
    textLayerDiv.style.width  = viewport.width  + "px";
    textLayerDiv.style.height = viewport.height + "px";
    wrapper.appendChild(textLayerDiv);

    container.appendChild(wrapper);

    // Render canvas
    await page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;

    // Render text layer — newer PDF.js requires --scale-factor on the container
    textLayerDiv.style.setProperty("--scale-factor", scale);
    const textContent = await page.getTextContent();
    await pdfjsLib.renderTextLayer({
      textContent,
      container: textLayerDiv,
      viewport,
      textDivs: [],
    }).promise;
  }

  rendering = false;
  if (pendingPage !== null) {
    const p = pendingPage;
    pendingPage = null;
    currentPage = p;
    await renderAll();
  }
}

// --- Load PDF ---
async function loadPdf() {
  try {
    const loadingTask = pdfjsLib.getDocument(pdfUrl);
    pdfDoc = await loadingTask.promise;
    await renderAll();
  } catch (e) {
    loadingMsg.style.display = "none";
    errorMsg.style.display   = "block";
    errorMsg.textContent     = "Failed to load PDF: " + e.message;
  }
}

// --- Controls ---
prevBtn.addEventListener("click", () => {
  if (currentPage > 1) { currentPage--; renderAll(); }
});
nextBtn.addEventListener("click", () => {
  if (pdfDoc && currentPage < pdfDoc.numPages) { currentPage++; renderAll(); }
});
zoomSelect.addEventListener("change", () => {
  scale = parseFloat(zoomSelect.value);
  renderAll();
});

// Keyboard navigation
document.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") nextBtn.click();
  if (e.key === "ArrowLeft"  || e.key === "ArrowUp")   prevBtn.click();
});

loadPdf();

// ── Selection relay ───────────────────────────────────────────────────────
// content.js can't inject into chrome-extension:// pages, so we replicate
// its logic here directly so text selected in the PDF reaches the side panel.
(function () {
  let lastSent = "";
  let timer = null;

  function relay(text) {
    try {
      chrome.runtime.sendMessage({ type: "textSelection", text }, () => {
        void chrome.runtime?.lastError;
      });
    } catch { /* extension invalidated */ }
  }

  document.addEventListener("selectionchange", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      let selected = "";
      try { selected = window.getSelection()?.toString().trim() ?? ""; } catch { return; }
      if (selected === lastSent) return;
      lastSent = selected;
      if (selected.length >= 3 || selected === "") relay(selected);
    }, 250);
  });
})();
