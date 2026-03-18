import "@testing-library/jest-dom";
import { IDBFactory } from "fake-indexeddb";

// ── IndexedDB ─────────────────────────────────────────────────────────────────
global.indexedDB = new IDBFactory();

// ── chrome API stub ───────────────────────────────────────────────────────────
const chromeStore = new Map();
global.chrome = {
  storage: {
    local: {
      get:    async (keys) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        const result = {};
        for (const k of keyList) if (chromeStore.has(k)) result[k] = chromeStore.get(k);
        return result;
      },
      set:    async (obj) => { for (const [k,v] of Object.entries(obj)) chromeStore.set(k,v); },
      remove: async (keys) => {
        const keyList = Array.isArray(keys) ? keys : [keys];
        for (const k of keyList) chromeStore.delete(k);
      },
    },
    onChanged: {
      addListener:    () => {},
      removeListener: () => {},
    },
  },
  runtime: { getURL: (path) => `chrome-extension://test-id/${path}` },
  windows: {
    getAll:        async () => [],
    onCreated:     { addListener: () => {}, removeListener: () => {} },
    onRemoved:     { addListener: () => {}, removeListener: () => {} },
    onFocusChanged:{ addListener: () => {}, removeListener: () => {} },
  },
  tabs: {
    create:           async () => {},
    query:            async () => [],
    captureVisibleTab:async () => "data:image/png;base64,",
    onActivated:      { addListener: () => {}, removeListener: () => {} },
    onUpdated:        { addListener: () => {}, removeListener: () => {} },
  },
};

// ── Reset chrome store + IDB before each test ─────────────────────────────────
beforeEach(() => {
  chromeStore.clear();
  global.indexedDB = new IDBFactory();
});

// ── Browser API stubs ─────────────────────────────────────────────────────────
global.URL.createObjectURL = vi.fn(() => "blob:mock");
global.URL.revokeObjectURL = vi.fn();

// jsdom doesn't implement scrollIntoView or clipboard
Element.prototype.scrollIntoView = vi.fn();
Object.assign(navigator, {
  clipboard: { writeText: vi.fn(async () => {}) },
});
