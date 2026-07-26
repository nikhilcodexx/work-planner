/* ===========================================
   BACKUP.JS — Import / Export / Backup Reminder
   Extends NatureFlow Planner without touching existing features.
   Depends on: storage.js (TaskStore, FlashStore, SettingsStore, Storage, STORAGE_KEYS)
   =========================================== */
(function () {
  'use strict';
  /* ===========================================
     CONSTANTS
     =========================================== */
  const APP_VERSION = '1.2.0';
  const SCHEMA_VERSION = 2;
  const BACKUP_VERSION = 2;
  const LAST_BACKUP_KEY = 'nf_last_backup_v1';
  const REMINDER_SNOOZE_KEY = 'nf_backup_reminder_snooze_v1';
  const BLOCKS_KEY = 'nf_blocks_v1'
  const REMINDER_DAYS = 7;
  const MAX_FILE_BYTES = 10 * 1024 * 1024;
  /* Keys treated as "planner state" — mirrored verbatim in exports
     so an import can rebuild the exact LocalStorage snapshot. */
  const KNOWN_STATE_KEYS = [
    'nf_tasks_v1',
    'nf_flashcards_v1',
    'nf_settings_v1',
    'nf_blocks_v1',
    'nf_blocks_migration_v1',
  ];
  /* ===========================================
     SMALL UTILS
     =========================================== */
  const $ = (s, c = document) => c.querySelector(s);
  const nowISO = () => new Date().toISOString();
  const pad2 = (n) => String(n).padStart(2, '0');
  const stamp = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}-${pad2(d.getHours())}-${pad2(d.getMinutes())}`;
  };
  const escapeHtml = (s = '') =>
    String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  /* ===========================================
     EXPORT — build enriched backup payload
     =========================================== */
 /* ===========================================
     COMPLETE PLANNER EXPORT SYSTEM
     -------------------------------------------
     Builds a full planner snapshot: workspace
     structure (blocks + categories), tasks,
     flashcards, settings, ALL known LocalStorage
     keys, and rich metadata. Returns a plain
     object ready to serialise as JSON.
     =========================================== */
  function readBlocksState() {
    // Prefer live BlockStore cache when blocks.js is loaded, else raw storage.
    try {
      if (typeof window.BlockStore !== 'undefined' && typeof window.BlockStore.load === 'function') {
        return window.BlockStore.load();
      }
    } catch (_) {}
    return Storage.read(BLOCKS_KEY, null);
  }
  function snapshotLocalStorage() {
    // Capture every known planner key verbatim + any nf_* keys we don't
    // recognise so forward-compat data isn't silently dropped.
    const snap = {};
    const seen = new Set();
    for (const k of KNOWN_STATE_KEYS) {
      seen.add(k);
      const raw = localStorage.getItem(k);
      snap[k] = raw == null ? null : safeParse(raw);
    }
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || seen.has(k)) continue;
        if (!k.startsWith('nf_')) continue;
        snap[k] = safeParse(localStorage.getItem(k));
      }
    } catch (_) {}
    return snap;
  }
  function safeParse(raw) {
    try { return JSON.parse(raw); } catch (_) { return raw; }
  }

  function buildBackupPayload() {
    const tasks = TaskStore.all();
    const flashcards = FlashStore.all();
    const settings = SettingsStore.get();

    const blocksState = readBlocksState();
    const blocks = (blocksState && Array.isArray(blocksState.blocks)) ? blocksState.blocks : [];
    // Derive category list from live workspace, falling back to task/flash tags.
    const structuredCats = [];
    for (const b of blocks) for (const c of (b.categories || [])) structuredCats.push(c.name);
    const derivedCats = Array.from(new Set([
      ...structuredCats,
      ...tasks.map((t) => t.section).filter(Boolean),
      ...flashcards.map((c) => c.category).filter(Boolean),
    ]));

    
    const now = new Date();
    return {
      app: 'NatureFlow Planner',
      version: APP_VERSION,
      schemaVersion: SCHEMA_VERSION,
      backupVersion: BACKUP_VERSION,
      exportedAt: now.toISOString(),
      exportDate: now.toLocaleDateString(),
      exportTime: now.toLocaleTimeString(),
       totals: {
        blocks: blocks.length,
        categories: structuredCats.length,
        tasks: tasks.length,
        flashcards: flashcards.length,
      },
      // Legacy fields kept for backward compatibility with v1 backups.
      theme: settings.theme,
      categories: derivedCats,
      settings,
      // Full workspace structure (order preserved via array order).
      workspace: { blocks: blocksState || { version: 1, blocks: [] } },
      data: { tasks, flashcards },
      // Verbatim LocalStorage snapshot — the authoritative restore source.
      localStorage: snapshotLocalStorage(),
    };
  }
  /* ===========================================
     EXPORT — download JSON file
     =========================================== */
  function downloadJSON(obj, filename) {
    const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
  function exportPlannerData() {
    try {
      const payload = buildBackupPayload();
      downloadJSON(payload, `natureflow-export-${stamp()}.json`);
      setLastBackupDate(new Date().toISOString());
      showNotification('✓ Backup exported', [
        `${payload.totals.blocks} Blocks`,
        `${payload.totals.categories} Categories`,
        `${payload.totals.tasks} Tasks`,
        `${payload.totals.flashcards} Flashcards`,
        
      ]);
      refreshBackupStatus();
    } catch (err) {
      console.error(err);
      showAlert('Export failed', 'Something went wrong while exporting your data.');
    }
  }
  /* ===========================================
     SAFETY BACKUP — auto download before replace
     =========================================== */
  function createSafetyBackup() {
    const payload = buildBackupPayload();
    payload.safetyBackup = true;
    downloadJSON(payload, `planner-backup-before-import-${stamp()}.json`);
  }
  /* ===========================================
    COMPLETE PLANNER IMPORT SYSTEM — validation
     -------------------------------------------
     Accepts both v1 (tasks/flashcards only) and
     v2 (with workspace + localStorage snapshot).
     Missing newer fields are backfilled with
     safe defaults instead of failing.
     =========================================== */
  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, reason: 'File is empty or not a JSON object.' };
  
    const tasks = obj?.data?.tasks ?? obj?.tasks;
    const flashcards = obj?.data?.flashcards ?? obj?.flashcards;
    if (!Array.isArray(tasks)) return { ok: false, reason: 'Missing or invalid "tasks" array.' };
    if (!Array.isArray(flashcards)) return { ok: false, reason: 'Missing or invalid "flashcards" array.' };
    for (const t of tasks) {
      if (!t || typeof t !== 'object') return { ok: false, reason: 'A task entry is not an object.' };
      if (t.title != null && typeof t.title !== 'string') return { ok: false, reason: 'Task "title" must be a string.' };
    }
    for (const c of flashcards) {
      if (!c || typeof c !== 'object') return { ok: false, reason: 'A flashcard entry is not an object.' };
      if (c.title != null && typeof c.title !== 'string') return { ok: false, reason: 'Flashcard "title" must be a string.' };
    }
    const settings = obj?.settings;
    if (settings != null && (typeof settings !== 'object' || Array.isArray(settings))) {
      return { ok: false, reason: '"settings" must be an object.' };
    }
       // Workspace (blocks) — optional for v1 backups.
    let workspace = null;
    const wsRaw = obj?.workspace?.blocks ?? obj?.localStorage?.[BLOCKS_KEY];
    if (wsRaw && typeof wsRaw === 'object') {
      const blocks = Array.isArray(wsRaw.blocks) ? wsRaw.blocks : (Array.isArray(wsRaw) ? wsRaw : null);
      if (blocks) {
        for (const b of blocks) {
          if (!b || typeof b !== 'object') return { ok: false, reason: 'A block entry is invalid.' };
          if (b.categories && !Array.isArray(b.categories)) return { ok: false, reason: 'Block "categories" must be an array.' };
        }
        workspace = { version: wsRaw.version || 1, blocks };
      }
    }
    const lsSnap = (obj.localStorage && typeof obj.localStorage === 'object') ? obj.localStorage : null;
    return { ok: true, tasks, flashcards, settings: settings || null, workspace, localStorage: lsSnap };
  }
  /* ===========================================
     MERGE MODE — combine imported data with existing
     -------------------------------------------
     • Blocks: match by id, then by name. Missing
       blocks are appended (order preserved).
     • Categories: match by id/name within block;
       missing categories appended in order.
     • Tasks/Flashcards: dedupe by id, or — when a
       record has no id — by a content key of
       title::block::section::deadline (tasks) or
       title::category (flashcards). Existing records
       are never overwritten, only added to.
     KNOWN SHARP EDGE: two genuinely different tasks
     that happen to share title+block+section with no
     deadline will collide on the content key and the
     import will be silently skipped as a "duplicate".
     This has not been changed here — see
     docs/ENGINEERING-NOTES.md for why, and what a
     real fix (e.g. content-hash the full record) would
     look like.
     =========================================== */
  function mergePlannerData(imported) {
        // 1) Merge workspace first so task refs remain valid.
    let addedBlocks = 0, addedCats = 0;
    if (imported.workspace && Array.isArray(imported.workspace.blocks)) {
      const currentState = readBlocksState() || { version: 1, blocks: [] };
      const current = Array.isArray(currentState.blocks) ? currentState.blocks.slice() : [];
      const byId   = new Map(current.map((b) => [b.id, b]));
      const byName = new Map(current.map((b) => [b.name, b]));
      for (const inB of imported.workspace.blocks) {
        const match = byId.get(inB.id) || byName.get(inB.name);
        if (!match) {
          current.push(deepClone(inB));
          byId.set(inB.id, inB);
          byName.set(inB.name, inB);
          addedBlocks++;
          continue;
        }
        // Merge categories preserving order.
        const catById   = new Map((match.categories || []).map((c) => [c.id, c]));
        const catByName = new Map((match.categories || []).map((c) => [c.name, c]));
        for (const inC of (inB.categories || [])) {
          if (catById.has(inC.id) || catByName.has(inC.name)) continue;
          match.categories = match.categories || [];
          match.categories.push(deepClone(inC));
          catById.set(inC.id, inC);
          catByName.set(inC.name, inC);
          addedCats++;
        }
      }
      Storage.write(BLOCKS_KEY, { version: currentState.version || 1, blocks: current });
      if (window.BlockStore) window.BlockStore._cache = null;
    }
    // 2) Tasks + flashcards.
    const existingTasks = TaskStore.all();
    const existingFlash = FlashStore.all();
    const taskKey = (t) => t.id || `${t.title}::${t.block}::${t.section}::${t.deadline || ''}`;
    const flashKey = (c) => c.id || `${c.title}::${c.category}`;
    const taskSeen = new Set(existingTasks.map(taskKey));
    const flashSeen = new Set(existingFlash.map(flashKey));
    let addedTasks = 0, addedFlash = 0;
    const mergedTasks = existingTasks.slice();
    for (const t of imported.tasks) {
      const k = taskKey(t);
      if (taskSeen.has(k)) continue;
      taskSeen.add(k); mergedTasks.push(t); addedTasks++;
    }
    const mergedFlash = existingFlash.slice();
    for (const c of imported.flashcards) {
      const k = flashKey(c);
      if (flashSeen.has(k)) continue;
      flashSeen.add(k); mergedFlash.push(c); addedFlash++;
    }
    TaskStore.save(mergedTasks);
    FlashStore.save(mergedFlash);
    return { blocks: addedBlocks, categories: addedCats, tasks: addedTasks, flashcards: addedFlash };
  }
  /* ===========================================
     REPLACE MODE — safety backup then overwrite
    -------------------------------------------
     Restores in strict order: Settings → Blocks
     → Tasks → Flashcards, then rehydrates any
     remaining LocalStorage keys from the
     snapshot so nothing is left behind.
     =========================================== */
  function replacePlannerData(imported) {
    createSafetyBackup();

     // 1) Settings
    if (imported.settings) SettingsStore.set(imported.settings);
    // 2) Blocks (workspace structure). Prefer explicit workspace,
    // fall back to localStorage snapshot's blocks key.
    if (imported.workspace) {
      Storage.write(BLOCKS_KEY, imported.workspace);
      if (window.BlockStore) window.BlockStore._cache = null;
    } else if (imported.localStorage && imported.localStorage[BLOCKS_KEY]) {
      Storage.write(BLOCKS_KEY, imported.localStorage[BLOCKS_KEY]);
      if (window.BlockStore) window.BlockStore._cache = null;
    }

    // 3) Tasks (order preserved from file)
    TaskStore.save(imported.tasks);

    // 4) Flashcards (order preserved from file)
    FlashStore.save(imported.flashcards);
    

    // 5) Any additional planner LocalStorage keys from the snapshot
    // that we haven't already restored above.
    if (imported.localStorage) {
      const handled = new Set(['nf_tasks_v1', 'nf_flashcards_v1', 'nf_settings_v1', BLOCKS_KEY]);
      for (const [k, v] of Object.entries(imported.localStorage)) {
        if (handled.has(k)) continue;
        if (v == null) { localStorage.removeItem(k); continue; }
        try {
          localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
        } catch (_) {}
      }
    }
    const wsBlocks = imported.workspace?.blocks?.length || 0;
    const wsCats = (imported.workspace?.blocks || []).reduce((n, b) => n + ((b.categories || []).length), 0);
    return {
      blocks: wsBlocks,
      categories: wsCats,
      tasks: imported.tasks.length,
      flashcards: imported.flashcards.length,
    };
  }

  function deepClone(v) {
    try { return JSON.parse(JSON.stringify(v)); } catch (_) { return v; }
  }
  
  /* ===========================================
     IMPORT ENTRY POINT — file → validate → confirm → apply
     =========================================== */
  function importPlannerData(file) {
    if (!file) return;
    if (!/\.json$/i.test(file.name) && file.type && file.type !== 'application/json') {
      showAlert('Wrong file type', 'Please choose a .json backup file.');
      return;
    }
    if (file.size === 0) return showAlert('Empty file', 'The selected file is empty.');
    if (file.size > MAX_FILE_BYTES) return showAlert('File too large', 'Backup file exceeds the 10 MB safety limit.');
    const reader = new FileReader();
    reader.onerror = () => showAlert('Read error', 'The browser could not read this file.');
    reader.onload = () => {
      let parsed;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch (e) {
        return showAlert('Invalid JSON', 'The file is not valid JSON or is corrupted.');
      }
      const result = validateBackup(parsed);
      if (!result.ok) return showAlert('Invalid backup', result.reason);
      showImportDialog(result, (mode) => {
        try {
          let summary;
          if (mode === 'merge') summary = mergePlannerData(result);
          else if (mode === 'replace') summary = replacePlannerData(result);
          else return; // cancelled
          // Notify the rest of the app so lists re-render without a hard reload.
          try { window.dispatchEvent(new CustomEvent('nf:data-imported')); } catch (_) {}
          // Rebuild blocks/sidebar/views if blocks.js exposes a rebuild hook.
          if (window.NFBlocks && typeof window.NFBlocks.rebuild === 'function') {
            try { window.NFBlocks.rebuild(); } catch (_) {}
          }
          if (typeof window.renderAll === 'function') window.renderAll();
          if (typeof window.renderFlashcards === 'function') window.renderFlashcards();

          const verb = mode === 'merge' ? 'added' : 'imported';
          showNotification('✓ Planner restored successfully', [
            `${summary.blocks || 0} Blocks ${verb}`,
            `${summary.categories || 0} Categories ${verb}`,
            `${summary.tasks} Tasks ${verb}`,
            `${summary.flashcards} Flashcards ${verb}`,
            `Mode: ${mode}`,
          ]);
        } catch (err) {
          console.error(err);
          showAlert('Import failed', 'An unexpected error occurred while applying the import.');
        }
      });
    };
    try {
      reader.readAsText(file);
    } catch (e) {
      showAlert('Browser error', 'Could not start reading the file.');
    }
  }
  /* ===========================================
     BACKUP REMINDER
     =========================================== */
  function getLastBackupDate() {
    return Storage.read(LAST_BACKUP_KEY, null);
  }
  function setLastBackupDate(iso) {
    Storage.write(LAST_BACKUP_KEY, iso);
    Storage.write(REMINDER_SNOOZE_KEY, null);
  }
  function daysSince(iso) {
    if (!iso) return Infinity;
    const ms = Date.now() - new Date(iso).getTime();
    return Math.floor(ms / (1000 * 60 * 60 * 24));
  }
  function checkBackupReminder() {
    const last = getLastBackupDate();
    const snoozeUntil = Storage.read(REMINDER_SNOOZE_KEY, null);
    if (snoozeUntil && Date.now() < snoozeUntil) return;
    const days = daysSince(last);
    if (days >= REMINDER_DAYS) showReminderDialog(days, last);
  }
  /* ===========================================
     UI — inject styles for backup dialogs & toast
     =========================================== */
  function injectStyles() {
    if (document.getElementById('nf-backup-styles')) return;
    const css = `
      .nf-backdrop{position:fixed;inset:0;background:rgba(10,20,20,.45);backdrop-filter:blur(6px);display:grid;place-items:center;z-index:9999;padding:16px;}
      .nf-backdrop[hidden]{display:none !important;}
      .nf-dialog{background:var(--panel,rgba(255,255,255,.9));color:inherit;border-radius:16px;max-width:440px;width:100%;padding:22px;box-shadow:0 20px 60px rgba(0,0,0,.25);}
      .nf-dialog h3{margin:0 0 8px;font-size:1.15rem;}
      .nf-dialog p{margin:6px 0;line-height:1.45;}
      .nf-dialog ul{margin:8px 0 4px;padding-left:18px;}
      .nf-actions{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;margin-top:16px;}
      .nf-btn{border:0;border-radius:10px;padding:8px 14px;font:inherit;cursor:pointer;background:rgba(0,0,0,.08);color:inherit;}
      .nf-btn.primary{background:var(--accent,#4f9d7d);color:#fff;}
      .nf-btn.danger{background:#c86464;color:#fff;}
      .nf-btn.ghost{background:transparent;}
      .nf-toast{position:fixed;right:20px;bottom:20px;background:var(--panel,rgba(255,255,255,.95));border-radius:14px;padding:14px 18px;box-shadow:0 12px 36px rgba(0,0,0,.2);z-index:10000;max-width:320px;animation:nfSlide .3s ease;}
      .nf-toast h4{margin:0 0 6px;color:var(--accent,#4f9d7d);}
      .nf-toast ul{margin:4px 0 0;padding-left:18px;font-size:.9em;}
      @keyframes nfSlide{from{transform:translateY(20px);opacity:0}to{transform:none;opacity:1}}
      #nf-backup-panel .setting-row{align-items:flex-start;}
      #nf-backup-panel .backup-meta{font-size:.85em;opacity:.75;display:block;margin-top:4px;}
    `;
    const style = document.createElement('style');
    style.id = 'nf-backup-styles';
    style.textContent = css;
    document.head.appendChild(style);
  }
  /* ===========================================
     UI — generic alert dialog
     =========================================== */
  function showAlert(title, message) {
    const bd = document.createElement('div');
    bd.className = 'nf-backdrop';
    bd.innerHTML = `
      <div class="nf-dialog" role="alertdialog" aria-modal="true">
        <h3>${escapeHtml(title)}</h3>
        <p>${escapeHtml(message)}</p>
        <div class="nf-actions"><button class="nf-btn primary" data-ok>OK</button></div>
      </div>`;
    document.body.appendChild(bd);
    bd.querySelector('[data-ok]').addEventListener('click', () => bd.remove());
  }
  /* ===========================================
     UI — import confirmation dialog (merge/replace/cancel)
     =========================================== */
  function showImportDialog(preview, cb) {
    const bd = document.createElement('div');
    bd.className = 'nf-backdrop';
    bd.innerHTML = `
      <div class="nf-dialog" role="dialog" aria-modal="true">
        <h3>Import planner data</h3>
        <p>This will modify your planner data. Choose how to apply the import:</p>
        <ul>
          <li>${(preview.workspace?.blocks?.length) || 0} blocks</li>
          <li>${(preview.workspace?.blocks || []).reduce((n, b) => n + ((b.categories || []).length), 0)} categories</li>
          <li>${preview.tasks.length} tasks</li>
          <li>${preview.flashcards.length} flashcards</li>
        </ul>
        <p><strong>Replace</strong> will download a safety backup of your current planner first.</p>
        <div class="nf-actions">
          <button class="nf-btn ghost" data-mode="cancel">Cancel</button>
          <button class="nf-btn" data-mode="merge">Merge</button>
          <button class="nf-btn danger" data-mode="replace">Replace</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    bd.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-mode]');
      if (!btn) return;
      const mode = btn.dataset.mode;
      bd.remove();
      cb(mode === 'cancel' ? null : mode);
    });
  }
  /* ===========================================
     UI — success toast notification
     =========================================== */
  function showNotification(title, lines = []) {
    const t = document.createElement('div');
    t.className = 'nf-toast';
    const now = new Date();
    t.innerHTML = `
      <h4>${escapeHtml(title)}</h4>
      <ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join('')}</ul>
      <div class="backup-meta" style="margin-top:6px;font-size:.8em;opacity:.7;">${now.toLocaleString()}</div>
    `;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }
  /* ===========================================
     UI — backup reminder dialog
     =========================================== */
  function showReminderDialog(days, lastISO) {
    const bd = document.createElement('div');
    bd.className = 'nf-backdrop';
    const lastText = lastISO ? new Date(lastISO).toLocaleDateString() : 'never';
    bd.innerHTML = `
      <div class="nf-dialog">
        <h3>Backup reminder</h3>
        <p>You haven't backed up your planner in ${days === Infinity ? 'a while' : days + ' days'} (last backup: ${escapeHtml(lastText)}).</p>
        <p>Would you like to create a backup now?</p>
        <div class="nf-actions">
          <button class="nf-btn ghost" data-act="dismiss">Dismiss</button>
          <button class="nf-btn" data-act="tomorrow">Remind me tomorrow</button>
          <button class="nf-btn primary" data-act="export">Export now</button>
        </div>
      </div>`;
    document.body.appendChild(bd);
    bd.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const act = btn.dataset.act;
      bd.remove();
      if (act === 'export') exportPlannerData();
      else if (act === 'tomorrow') Storage.write(REMINDER_SNOOZE_KEY, Date.now() + 24 * 60 * 60 * 1000);
      // dismiss = do nothing (will re-check next open, still overdue)
    });
  }
  /* ===========================================
     UI — inject Backup & Restore section into Settings
     =========================================== */
  function injectSettingsSection() {
    const settingsPanel = document.querySelector('#view-settings .settings-panel');
    if (!settingsPanel || document.getElementById('nf-backup-panel')) return;
    const wrap = document.createElement('div');
    wrap.id = 'nf-backup-panel';
    wrap.innerHTML = `
      <div class="setting-row">
        <label>Backup &amp; Restore</label>
        <div class="btn-group">
          <button class="chip" id="nfExportBtn">Export Data</button>
          <button class="chip" id="nfImportBtn">Import Data</button>
          <input type="file" id="nfImportFile" accept="application/json,.json" hidden />
        </div>
      </div>
      <div class="setting-row">
        <label>Status</label>
        <div>
          <span class="backup-meta" id="nfLastBackup">Last backup: —</span>
          <span class="backup-meta" id="nfNextReminder">Next reminder: —</span>
          <span class="backup-meta" id="nfBackupStatus">Backup status: —</span>
          <span class="backup-meta">Version: ${APP_VERSION}</span>
        </div>
      </div>
    `;
    settingsPanel.appendChild(wrap);
    $('#nfExportBtn').addEventListener('click', exportPlannerData);
    $('#nfImportBtn').addEventListener('click', () => $('#nfImportFile').click());
    $('#nfImportFile').addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      importPlannerData(file);
      e.target.value = ''; // allow re-selecting same file
    });
    refreshBackupStatus();
  }
  function refreshBackupStatus() {
    const last = getLastBackupDate();
    const days = daysSince(last);
    const lastEl = document.getElementById('nfLastBackup');
    const nextEl = document.getElementById('nfNextReminder');
    const statusEl = document.getElementById('nfBackupStatus');
    if (!lastEl) return;
    lastEl.textContent = 'Last backup: ' + (last ? new Date(last).toLocaleString() : 'never');
    const remaining = Math.max(0, REMINDER_DAYS - (days === Infinity ? REMINDER_DAYS : days));
    nextEl.textContent = 'Next reminder: ' + (last ? `in ${remaining} day(s)` : 'as soon as you open the planner');
    statusEl.textContent = 'Backup status: ' + (days === Infinity ? 'no backup yet' : days >= REMINDER_DAYS ? 'overdue' : 'up to date');
  }
  /* ===========================================
     BOOTSTRAP
     =========================================== */
  function boot() {
    if (typeof TaskStore === 'undefined' || typeof FlashStore === 'undefined' || typeof SettingsStore === 'undefined') {
      console.warn('[backup.js] storage.js not loaded — backup features disabled.');
      return;
    }
    injectStyles();
    injectSettingsSection();
    // Expose for debugging / manual invocation
    window.NFBackup = {
      exportPlannerData, importPlannerData, validateBackup,
      mergePlannerData, replacePlannerData, createSafetyBackup,
      checkBackupReminder,
    };
    // Delay reminder slightly so the app UI settles first.
    setTimeout(checkBackupReminder, 1200);
  }
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
  /* ===========================================
     NODE/TEST EXPORTS
     Only defined under a CommonJS module system (node:test).
     Browser behavior above (window.NFBackup, boot()) is unchanged.
     =========================================== */
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      validateBackup, mergePlannerData, replacePlannerData,
      snapshotLocalStorage, buildBackupPayload, daysSince,
    };
  }
})();