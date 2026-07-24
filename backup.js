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
  const APP_VERSION = '1.1.0';
  const LAST_BACKUP_KEY = 'nf_last_backup_v1';
  const REMINDER_SNOOZE_KEY = 'nf_backup_reminder_snooze_v1';
  const REMINDER_DAYS = 7;
  const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB safety cap
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
  function buildBackupPayload() {
    const tasks = TaskStore.all();
    const flashcards = FlashStore.all();
    const settings = SettingsStore.get();
    const categories = Array.from(
      new Set([
        ...tasks.map((t) => t.section).filter(Boolean),
        ...flashcards.map((c) => c.category).filter(Boolean),
      ]),
    );
    const now = new Date();
    return {
      app: 'NatureFlow Planner',
      version: APP_VERSION,
      exportedAt: now.toISOString(),
      exportDate: now.toLocaleDateString(),
      exportTime: now.toLocaleTimeString(),
      totals: { tasks: tasks.length, flashcards: flashcards.length, categories: categories.length },
      theme: settings.theme,
      categories,
      settings,
      data: { tasks, flashcards },
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
        `${payload.totals.tasks} Tasks`,
        `${payload.totals.flashcards} Flashcards`,
        `${payload.totals.categories} Categories`,
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
     VALIDATION — sanity-check imported JSON
     =========================================== */
  function validateBackup(obj) {
    if (!obj || typeof obj !== 'object') return { ok: false, reason: 'File is empty or not a JSON object.' };
    // Accept our enriched shape OR the older shape from script.js's Export.
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
    return { ok: true, tasks, flashcards, settings: settings || null };
  }
  /* ===========================================
     MERGE MODE — combine imported data with existing
     =========================================== */
  function mergePlannerData(imported) {
    const existingTasks = TaskStore.all();
    const existingFlash = FlashStore.all();
    const taskKey = (t) => t.id || `${t.title}::${t.block}::${t.section}::${t.deadline || ''}`;
    const flashKey = (c) => c.id || `${c.title}::${c.category}`;
    const taskSeen = new Set(existingTasks.map(taskKey));
    const flashSeen = new Set(existingFlash.map(flashKey));
    let addedTasks = 0;
    let addedFlash = 0;
    const mergedTasks = existingTasks.slice();
    for (const t of imported.tasks) {
      const k = taskKey(t);
      if (taskSeen.has(k)) continue;
      taskSeen.add(k);
      mergedTasks.push(t);
      addedTasks++;
    }
    const mergedFlash = existingFlash.slice();
    for (const c of imported.flashcards) {
      const k = flashKey(c);
      if (flashSeen.has(k)) continue;
      flashSeen.add(k);
      mergedFlash.push(c);
      addedFlash++;
    }
    TaskStore.save(mergedTasks);
    FlashStore.save(mergedFlash);
    return { tasks: addedTasks, flashcards: addedFlash };
  }
  /* ===========================================
     REPLACE MODE — safety backup then overwrite
     =========================================== */
  function replacePlannerData(imported) {
    createSafetyBackup();
    TaskStore.save(imported.tasks);
    FlashStore.save(imported.flashcards);
    if (imported.settings) SettingsStore.set(imported.settings);
    return { tasks: imported.tasks.length, flashcards: imported.flashcards.length };
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
          if (typeof window.renderAll === 'function') window.renderAll();
          if (typeof window.renderFlashcards === 'function') window.renderFlashcards();
          showNotification('✓ Planner restored successfully', [
            `${summary.tasks} Tasks ${mode === 'merge' ? 'added' : 'imported'}`,
            `${summary.flashcards} Flashcards ${mode === 'merge' ? 'added' : 'imported'}`,
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();