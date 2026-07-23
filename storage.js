/* ===================================================================
   STORAGE.JS — LocalStorage abstraction for NatureFlow Planner
   All data persists locally in the browser. No server required.
   =================================================================== */
/* ===================================== */
/* STORAGE KEYS                          */
/* ===================================== */
const STORAGE_KEYS = {
  TASKS: 'nf_tasks_v1',
  FLASHCARDS: 'nf_flashcards_v1',
  SETTINGS: 'nf_settings_v1',
};
/* ===================================== */
/* GENERIC READ / WRITE                  */
/* ===================================== */
const Storage = {
  read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn('Storage read failed', key, e);
      return fallback;
    }
  },
  write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn('Storage write failed', key, e);
    }
  },
  clearAll() {
    Object.values(STORAGE_KEYS).forEach((k) => localStorage.removeItem(k));
  },
};
/* ===================================== */
/* TASK STORAGE HELPERS                  */
/* ===================================== */
const TaskStore = {
  all() { return Storage.read(STORAGE_KEYS.TASKS, []); },
  save(list) { Storage.write(STORAGE_KEYS.TASKS, list); },
  add(task) { const list = this.all(); list.push(task); this.save(list); },
  update(id, patch) {
    const list = this.all().map((t) => (t.id === id ? { ...t, ...patch } : t));
    this.save(list);
  },
  remove(id) { this.save(this.all().filter((t) => t.id !== id)); },
};
/* ===================================== */
/* FLASHCARD STORAGE HELPERS             */
/* ===================================== */
const FlashStore = {
  all() { return Storage.read(STORAGE_KEYS.FLASHCARDS, []); },
  save(list) { Storage.write(STORAGE_KEYS.FLASHCARDS, list); },
  add(card) { const list = this.all(); list.push(card); this.save(list); },
  update(id, patch) {
    const list = this.all().map((c) => (c.id === id ? { ...c, ...patch } : c));
    this.save(list);
  },
  remove(id) { this.save(this.all().filter((c) => c.id !== id)); },
};
/* ===================================== */
/* SETTINGS STORAGE HELPERS              */
/* ===================================== */
const SettingsStore = {
  defaults: {
    theme: 'light',
    fontSize: 16,
    cardSize: 1,
    animSpeed: 1,
    bgBlur: 18,
    accent: '#4f9d7d',
  },
  get() { return { ...this.defaults, ...Storage.read(STORAGE_KEYS.SETTINGS, {}) }; },
  set(patch) { Storage.write(STORAGE_KEYS.SETTINGS, { ...this.get(), ...patch }); },
};
