/* ===================================================================
   BACKUP.TEST.JS — characterization tests for the backup/import
   system in backup.js. This is the code most likely to silently
   corrupt a user's real tasks/flashcards if it has a bug, and it
   had zero coverage before this file.

   backup.js is a browser-global IIFE with no module system, so we
   stub the globals it expects (TaskStore, FlashStore, SettingsStore,
   Storage, window, localStorage) BEFORE requiring it, matching how
   storage.js/script.js define them via <script> tags in the browser.
   `document`/`Blob`/`URL` are deliberately left undefined until the
   one test that needs them, so backup.js's own `typeof document`
   guard skips its auto-boot() during `require()`.
   =================================================================== */
const test = require('node:test');
const assert = require('node:assert/strict');

const memory = new Map();
global.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
  get length() { return memory.size; },
  key: (i) => Array.from(memory.keys())[i],
};
global.Storage = {
  read(key, fallback) {
    const raw = global.localStorage.getItem(key);
    try { return raw != null ? JSON.parse(raw) : fallback; } catch { return fallback; }
  },
  write(key, value) { global.localStorage.setItem(key, JSON.stringify(value)); },
};
let tasks = [];
let flashcards = [];
let settings = {};
global.TaskStore = { all: () => tasks, save: (list) => { tasks = list; } };
global.FlashStore = { all: () => flashcards, save: (list) => { flashcards = list; } };
global.SettingsStore = { get: () => settings, set: (patch) => { settings = { ...settings, ...patch }; } };
global.window = {};

const { validateBackup, mergePlannerData, replacePlannerData } = require('../backup.js');

function resetState() {
  tasks = [];
  flashcards = [];
  settings = {};
  memory.clear();
  global.window = {};
}

/* ===========================================
   validateBackup — pure, no stubs needed
   =========================================== */
test('validateBackup rejects null / non-object', () => {
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup('nope').ok, false);
});

test('validateBackup rejects missing/invalid tasks or flashcards arrays', () => {
  assert.equal(validateBackup({ tasks: 'x', flashcards: [] }).ok, false);
  assert.equal(validateBackup({ tasks: [], flashcards: 'x' }).ok, false);
});

test('validateBackup rejects a task entry that is not an object', () => {
  const r = validateBackup({ tasks: ['nope'], flashcards: [] });
  assert.equal(r.ok, false);
});

test('validateBackup rejects a task with a non-string title', () => {
  const r = validateBackup({ tasks: [{ title: 123 }], flashcards: [] });
  assert.equal(r.ok, false);
});

test('validateBackup rejects settings that is an array or non-object', () => {
  assert.equal(validateBackup({ tasks: [], flashcards: [], settings: [] }).ok, false);
  assert.equal(validateBackup({ tasks: [], flashcards: [], settings: 'x' }).ok, false);
});

test('validateBackup accepts a v1 shape (top-level tasks/flashcards, no workspace)', () => {
  const r = validateBackup({ tasks: [{ title: 'A' }], flashcards: [] });
  assert.equal(r.ok, true);
  assert.equal(r.workspace, null);
});

test('validateBackup accepts a v2 shape with workspace + localStorage snapshot', () => {
  const r = validateBackup({
    data: { tasks: [{ title: 'A' }], flashcards: [] },
    settings: { theme: 'dark' },
    workspace: { blocks: { version: 1, blocks: [{ id: 'b1', name: 'Work', categories: [] }] } },
    localStorage: {},
  });
  assert.equal(r.ok, true);
  assert.equal(r.workspace.blocks.length, 1);
  assert.equal(r.workspace.blocks[0].name, 'Work');
});

test('validateBackup falls back to localStorage snapshot for blocks when no top-level workspace', () => {
  const r = validateBackup({
    tasks: [], flashcards: [],
    localStorage: { nf_blocks_v1: { version: 1, blocks: [{ id: 'b1', name: 'Work', categories: [] }] } },
  });
  assert.equal(r.ok, true);
  assert.equal(r.workspace.blocks.length, 1);
});

test('validateBackup rejects a block with non-array categories', () => {
  const r = validateBackup({
    tasks: [], flashcards: [],
    workspace: { blocks: { blocks: [{ id: 'b1', name: 'Work', categories: 'nope' }] } },
  });
  assert.equal(r.ok, false);
});

test('validateBackup normalizes a bare-array blocks list to {version, blocks}', () => {
  const r = validateBackup({
    tasks: [], flashcards: [],
    workspace: { blocks: [{ id: 'b1', name: 'Work', categories: [] }] },
  });
  assert.equal(r.ok, true);
  assert.equal(r.workspace.version, 1);
  assert.equal(r.workspace.blocks.length, 1);
});

/* ===========================================
   mergePlannerData — dedupe by id / content key
   =========================================== */
test('mergePlannerData adds tasks and flashcards into an empty store', () => {
  resetState();
  const result = mergePlannerData({
    tasks: [{ id: 'a', title: 'Task A' }, { id: 'b', title: 'Task B' }],
    flashcards: [{ id: 'c', title: 'Card C' }],
  });
  assert.deepEqual(result, { blocks: 0, categories: 0, tasks: 2, flashcards: 1 });
  assert.equal(tasks.length, 2);
  assert.equal(flashcards.length, 1);
});

test('mergePlannerData dedupes tasks by id and never overwrites the existing copy', () => {
  resetState();
  tasks = [{ id: 'a', title: 'Original' }];
  const result = mergePlannerData({
    tasks: [{ id: 'a', title: 'Imported Version' }, { id: 'b', title: 'New' }],
    flashcards: [],
  });
  assert.equal(result.tasks, 1, 'only the genuinely new task should be counted');
  const a = tasks.find((t) => t.id === 'a');
  assert.equal(a.title, 'Original', 'merge must never overwrite an existing task');
  assert.ok(tasks.some((t) => t.id === 'b'));
});

test('mergePlannerData dedupes tasks without ids by content key', () => {
  resetState();
  tasks = [{ title: 'Write report', block: 'work', section: 'todo', deadline: '' }];
  const result = mergePlannerData({
    tasks: [{ title: 'Write report', block: 'work', section: 'todo', deadline: '' }],
    flashcards: [],
  });
  assert.equal(result.tasks, 0, 'identical content-key task should be treated as a duplicate');
  assert.equal(tasks.length, 1);
});

test('mergePlannerData merges blocks: appends a new block and a new category on a matched block', () => {
  resetState();
  memory.set('nf_blocks_v1', JSON.stringify({
    version: 1,
    blocks: [{ id: 'w', name: 'Work', categories: [{ id: 'c1', name: 'A' }] }],
  }));
  const result = mergePlannerData({
    tasks: [], flashcards: [],
    workspace: {
      blocks: [
        { id: 'w', name: 'Work', categories: [{ id: 'c1', name: 'A' }, { id: 'c2', name: 'B' }] },
        { id: 'h', name: 'Home', categories: [] },
      ],
    },
  });
  assert.equal(result.blocks, 1, 'one new block (Home)');
  assert.equal(result.categories, 1, 'one new category (B) on the matched Work block');
  const saved = JSON.parse(memory.get('nf_blocks_v1'));
  const work = saved.blocks.find((b) => b.id === 'w');
  assert.equal(work.categories.length, 2);
  assert.ok(saved.blocks.some((b) => b.name === 'Home'));
});

test('mergePlannerData matches an existing block by name when ids differ', () => {
  resetState();
  memory.set('nf_blocks_v1', JSON.stringify({
    version: 1,
    blocks: [{ id: 'local-id', name: 'Work', categories: [] }],
  }));
  const result = mergePlannerData({
    tasks: [], flashcards: [],
    workspace: { blocks: [{ id: 'imported-id', name: 'Work', categories: [] }] },
  });
  assert.equal(result.blocks, 0, 'same name should match instead of duplicating');
  const saved = JSON.parse(memory.get('nf_blocks_v1'));
  assert.equal(saved.blocks.length, 1);
});

/* ===========================================
   replacePlannerData — needs document/Blob/URL,
   stubbed only for this test.
   =========================================== */
test('replacePlannerData overwrites tasks verbatim and takes a safety backup first', () => {
  resetState();
  const created = [];
  global.document = {
    createElement: () => ({ click() {}, remove() {} }),
    body: { appendChild() {} },
  };
  global.Blob = class { constructor(parts) { this.parts = parts; } };
  global.URL = {
    createObjectURL: (blob) => { created.push(blob); return 'blob:fake'; },
    revokeObjectURL: () => {},
  };

  const imported = {
    tasks: [{ id: 'x', title: 'Imported Task' }],
    flashcards: [{ id: 'y', title: 'Imported Card' }],
    settings: null,
    workspace: null,
    localStorage: null,
  };
  const result = replacePlannerData(imported);

  assert.deepEqual(tasks, imported.tasks, 'tasks are replaced verbatim, in order');
  assert.deepEqual(flashcards, imported.flashcards);
  assert.equal(created.length, 1, 'a safety backup Blob should be created before overwriting');
  assert.equal(result.tasks, 1);
  assert.equal(result.flashcards, 1);
});

test('replacePlannerData only writes nf_-namespaced keys from an imported localStorage snapshot, never arbitrary ones', () => {
  resetState();
  global.document = {
    createElement: () => ({ click() {}, remove() {} }),
    body: { appendChild() {} },
  };
  global.Blob = class { constructor(parts) { this.parts = parts; } };
  global.URL = { createObjectURL: () => 'blob:fake', revokeObjectURL: () => {} };

  const setSpy = [];
  const removeSpy = [];
  const realSetItem = global.localStorage.setItem;
  const realRemoveItem = global.localStorage.removeItem;
  global.localStorage.setItem = (k, v) => { setSpy.push(k); realSetItem(k, v); };
  global.localStorage.removeItem = (k) => { removeSpy.push(k); realRemoveItem(k); };

  replacePlannerData({
    tasks: [], flashcards: [], settings: null, workspace: null,
    localStorage: {
      nf_blocks_migration_v1: { done: true },       // ours — should be written
      evil_other_app_key: 'overwritten',              // NOT ours — must be rejected
      __proto__: 'ignored-anyway',                    // NOT ours — must be rejected
    },
  });

  global.localStorage.setItem = realSetItem;
  global.localStorage.removeItem = realRemoveItem;

  assert.ok(setSpy.includes('nf_blocks_migration_v1'), 'an nf_-namespaced key should be restored');
  assert.ok(!setSpy.includes('evil_other_app_key'), 'a key outside the nf_ namespace must never be written');
  assert.ok(!removeSpy.includes('evil_other_app_key'));
});
