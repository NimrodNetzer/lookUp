// offscreen.js — Runs MediaRecorder in the background so recording survives
// when the side panel is closed. Chunks are persisted to a dedicated IndexedDB
// ("lookup-recording") so the side panel can read them after it reopens.

const RECORDING_DB = "lookup-recording";
let _rdb = null;

function openRecordingDB() {
  if (_rdb) return Promise.resolve(_rdb);
  return new Promise((res, rej) => {
    const req = indexedDB.open(RECORDING_DB, 1);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains("chunks")) {
        db.createObjectStore("chunks", { autoIncrement: true });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta");
      }
    };
    req.onsuccess = (e) => { _rdb = e.target.result; res(_rdb); };
    req.onerror = () => rej(req.error);
  });
}

async function clearRecordingDB() {
  const db = await openRecordingDB();
  return new Promise((res, rej) => {
    const t = db.transaction(["chunks", "meta"], "readwrite");
    t.objectStore("chunks").clear();
    t.objectStore("meta").clear();
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

async function storeChunk(blob) {
  const db = await openRecordingDB();
  const buf = await blob.arrayBuffer();
  return new Promise((res, rej) => {
    const t = db.transaction("chunks", "readwrite");
    const r = t.objectStore("chunks").add(buf);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

async function storeMeta(obj) {
  const db = await openRecordingDB();
  return new Promise((res, rej) => {
    const t = db.transaction("meta", "readwrite");
    const s = t.objectStore("meta");
    for (const [k, v] of Object.entries(obj)) s.put(v, k);
    t.oncomplete = res;
    t.onerror = () => rej(t.error);
  });
}

let mediaRecorder = null;
let _blobType = "audio/webm";

async function startRecording({ source, streamId }) {
  await clearRecordingDB();

  let stream;
  if (source === "tab") {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: "tab", chromeMediaSourceId: streamId } },
      video: false,
    });
    // Route audio back to speakers so the user can still hear the tab
    const ctx = new AudioContext();
    ctx.createMediaStreamSource(stream).connect(ctx.destination);
    stream.getAudioTracks()[0].addEventListener("ended", () => ctx.close());
  } else {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
  }

  _blobType = MediaRecorder.isTypeSupported("audio/webm") ? "audio/webm" : "audio/ogg";
  mediaRecorder = new MediaRecorder(stream, { mimeType: _blobType });

  mediaRecorder.ondataavailable = async (e) => {
    if (e.data.size > 0) await storeChunk(e.data);
  };

  mediaRecorder.onstop = async () => {
    stream.getTracks().forEach(t => t.stop());
    await storeMeta({ blobType: _blobType });
    chrome.runtime.sendMessage({ type: "recordingDone" });
  };

  mediaRecorder.start(1000);
}

function stopRecording() {
  if (mediaRecorder?.state !== "inactive") mediaRecorder.stop();
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "offscreen:start") {
    startRecording(msg).catch((err) =>
      chrome.runtime.sendMessage({ type: "recordingError", error: err.message })
    );
  } else if (msg.type === "offscreen:stop") {
    stopRecording();
  }
});
