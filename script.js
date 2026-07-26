/* ===================================================================
   SCRIPT.JS — NatureFlow Planner main application logic
   Depends on: storage.js, theme.js, animation.js
   =================================================================== */
/* ===================================== */
/* UTILITIES                             */
/* ===================================== */
const $  = (sel, ctx = document) => ctx.querySelector(sel);
const $$ = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const todayISO = () => new Date().toISOString().slice(0, 10);
function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}
/* ===================================== */
/* DAILY QUOTES                          */
/* ===================================== */
const QUOTES = [
  "Small steps every day carve mountains.",
  "The river doesn't rush — yet it always arrives.",
  "Grow like a tree: quietly, patiently, upward.",
  "Discipline is choosing what you want most over what you want now.",
  "Do the work only you can do today.",
  "A calm mind is a productive mind.",
  "Nature never hurries, yet everything is accomplished.",
  "Focus is a superpower disguised as boredom.",
];
/* ===================================================================
   INITIAL BOOTSTRAP
   =================================================================== */
if (typeof document !== 'undefined') {
document.addEventListener('DOMContentLoaded', () => {
  Theme.apply(SettingsStore.get());
  bindNavigation();
  bindTopbar();
  bindTaskUI();
  bindFlashcards();
  bindSettings();
  bindSearch();
  renderAll();
  startClock();
  showDailyQuote();
  if (window.lucide) window.lucide.createIcons();
});
} // end typeof document guard
/* ===================================================================
   NAVIGATION BETWEEN VIEWS
   =================================================================== */
function bindNavigation() {
  $$('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      $$('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.view').forEach((v) => v.classList.remove('active'));
      const target = $('#view-' + view);
      if (target) target.classList.add('active');
      $('#sidebar').classList.remove('open');
    });
  });
}
/* ===================================================================
   TOPBAR (menu + theme toggle)
   =================================================================== */
function bindTopbar() {
  $('#menuBtn')?.addEventListener('click', () => $('#sidebar').classList.toggle('open'));
  $('#themeToggle')?.addEventListener('click', () => Theme.toggle());
}
/* ===================================================================
   CLOCK + DATE
   =================================================================== */
function startClock() {
  const clock = $('#clock');
  const dateEl = $('#todayDate');
  const tick = () => {
    const now = new Date();
    const t = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (clock) clock.textContent = t;
    if (dateEl) dateEl.textContent = now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  };
  tick(); setInterval(tick, 1000 * 30);
}
/* ===================================================================
   DAILY QUOTE
   =================================================================== */
function showDailyQuote() {
  const day = new Date().getDate();
  $('#dailyQuote').textContent = '“' + QUOTES[day % QUOTES.length] + '”';
}
/* ===================================================================
   TASK UI — modal, add, edit, delete, drag & drop
   =================================================================== */
function bindTaskUI() {
  // Add buttons on every section panel
  document.addEventListener('click', (e) => {
    const addBtn = e.target.closest('.add-task');
    if (addBtn) openTaskModal({ block: addBtn.dataset.block, section: addBtn.dataset.section });
  });
  // Modal form submit
  $('#taskForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveTaskFromForm();
  });
  // Close modal handlers
  $$('[data-close-modal]').forEach((el) => {
    el.addEventListener('click', () => closeModal(el.dataset.closeModal));
  });
  $$('.modal-backdrop').forEach((bd) => {
    bd.addEventListener('click', (e) => { if (e.target === bd) closeModal(bd.id); });
  });
  // Task list delegate: check / edit / delete / duplicate
  document.addEventListener('click', (e) => {
    const task = e.target.closest('.task');
    if (!task) return;
    const id = task.dataset.id;
    if (e.target.closest('.task-check')) {
      const t = TaskStore.all().find((x) => x.id === id);
      TaskStore.update(id, { done: !t.done });
      renderAll();
    } else if (e.target.closest('[data-act="edit"]')) {
      const t = TaskStore.all().find((x) => x.id === id);
      openTaskModal(t);
    } else if (e.target.closest('[data-act="delete"]')) {
      TaskStore.remove(id);
      renderAll();
    } else if (e.target.closest('[data-act="duplicate"]')) {
      const t = TaskStore.all().find((x) => x.id === id);
      TaskStore.add({ ...t, id: uid(), done: false, createdAt: Date.now() });
      renderAll();
    }
  });
  bindDragAndDrop();
}
/* ===================================== */
/* OPEN / CLOSE TASK MODAL               */
/* ===================================== */
function openTaskModal(data = {}) {
  $('#taskModalTitle').textContent = data.id ? 'Edit Task' : 'New Task';
  $('#taskId').value = data.id || '';
  $('#taskBlock').value = data.block || '';
  $('#taskSection').value = data.section || '';
  $('#taskTitle').value = data.title || '';
  $('#taskDesc').value = data.description || '';
  $('#taskPriority').value = data.priority || 'medium';
  $('#taskDeadline').value = data.deadline || '';
  $('#taskTags').value = (data.tags || []).join(', ');
  $('#taskProgress').value = data.progress ?? 0;
  $('#taskNotes').value = data.notes || '';
  openModal('taskModal');
  setTimeout(() => $('#taskTitle').focus(), 50);
}
function openModal(id) { $('#' + id).hidden = false; }
function closeModal(id) { $('#' + id).hidden = true; }
/* ===================================== */
/* SAVE TASK FROM FORM                   */
/* ===================================== */
function saveTaskFromForm() {
  const id = $('#taskId').value;
  const payload = {
    block: $('#taskBlock').value,
    section: $('#taskSection').value,
    title: $('#taskTitle').value.trim(),
    description: $('#taskDesc').value.trim(),
    priority: $('#taskPriority').value,
    deadline: $('#taskDeadline').value,
    tags: $('#taskTags').value.split(',').map((s) => s.trim()).filter(Boolean),
    progress: Number($('#taskProgress').value),
    notes: $('#taskNotes').value.trim(),
  };
  if (id) {
    TaskStore.update(id, payload);
  } else {
    TaskStore.add({ id: uid(), done: false, createdAt: Date.now(), ...payload });
  }
  closeModal('taskModal');
  renderAll();
}
/* ===================================================================
   DRAG & DROP TASKS BETWEEN SECTIONS / BLOCKS
   =================================================================== */
function bindDragAndDrop() {
  document.addEventListener('dragstart', (e) => {
    const task = e.target.closest('.task');
    if (!task) return;
    task.classList.add('dragging');
    e.dataTransfer.setData('text/plain', task.dataset.id);
    e.dataTransfer.effectAllowed = 'move';
  });
  document.addEventListener('dragend', (e) => {
    const task = e.target.closest('.task');
    if (task) task.classList.remove('dragging');
    $$('.task-list.drag-over').forEach((l) => l.classList.remove('drag-over'));
  });
  document.addEventListener('dragover', (e) => {
    const list = e.target.closest('.task-list');
    if (!list) return;
    e.preventDefault();
    list.classList.add('drag-over');
  });
  document.addEventListener('dragleave', (e) => {
    const list = e.target.closest('.task-list');
    if (list && !list.contains(e.relatedTarget)) list.classList.remove('drag-over');
  });
  document.addEventListener('drop', (e) => {
    const list = e.target.closest('.task-list');
    if (!list) return;
    e.preventDefault();
    list.classList.remove('drag-over');
    const id = e.dataTransfer.getData('text/plain');
    const [block, section] = list.dataset.list.split('::');
    TaskStore.update(id, { block, section });
    renderAll();
  });
}
/* ===================================================================
   RENDER — tasks in every section + dashboard stats
   =================================================================== */
function renderAll() {
  const tasks = TaskStore.all();
  const search = ($('#globalSearch')?.value || '').toLowerCase().trim();
  // Clear all lists
  const lists = new Map($$('.task-list').map((ul) => (ul.innerHTML = '', [ul.dataset.list, ul])));
  // Group tasks per list — one lookup map built once, instead of a
  // querySelector per task.
  tasks.forEach((t) => {
    if (search && !matchesSearch(t, search)) return;
    const listEl = lists.get(`${t.block}::${t.section}`);
    if (listEl) listEl.appendChild(renderTask(t));
  });
  // Dashboard stats
  const today = todayISO();
  const todays = tasks.filter((t) => t.deadline === today || (!t.deadline && !t.done));
  const done = tasks.filter((t) => t.done).length;
  const pending = tasks.length - done;
  const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
  $('#statToday').textContent = todays.length;
  $('#statDone').textContent = done;
  $('#statPending').textContent = pending;
  $('#statPercent').textContent = percent + '%';
  $('#progressFill').style.width = percent + '%';
  // Focus list — up to 5 pending
  const focus = tasks.filter((t) => !t.done).slice(0, 5);
  const ml = $('#miniList');
  if (focus.length) {
    ml.innerHTML = focus.map((t) => `<li>• ${escapeHtml(t.title)} <span class="tiny muted">— ${escapeHtml(t.section)}</span></li>`).join('');
  } else {
    ml.innerHTML = '<li class="muted">Nothing pending — enjoy the river 🌊</li>';
  }
  if (window.lucide) window.lucide.createIcons();
}
function matchesSearch(t, q) {
  // Lowercase the query here too, not just the haystack — matchesSearch
  // should be case-insensitive on its own rather than silently depending
  // on every caller pre-lowercasing (a characterization test caught this:
  // matchesSearch(task, 'WRITE') used to return false).
  const needle = String(q || '').toLowerCase();
  const hay = [t.title, t.description, t.section, t.block, (t.tags || []).join(' '), t.notes]
    .filter(Boolean).join(' ').toLowerCase();
  return hay.includes(needle);
}
function renderTask(t) {
  const li = document.createElement('li');
  li.className = `task p-${t.priority || 'medium'}${t.done ? ' done' : ''}`;
  li.draggable = true;
  li.dataset.id = t.id;
  li.innerHTML = `
    <div class="task-check ${t.done ? 'checked' : ''}" role="checkbox" aria-checked="${t.done}"></div>
    <div class="task-body">
      <div class="task-title">${escapeHtml(t.title)}</div>
      <div class="task-meta">
        <span class="pill">${t.priority}</span>
        ${t.deadline ? `<span class="pill">📅 ${t.deadline}</span>` : ''}
        ${t.progress ? `<span class="pill">${t.progress}%</span>` : ''}
        ${(t.tags || []).map((tag) => `<span class="pill">#${escapeHtml(tag)}</span>`).join('')}
      </div>
    </div>
    <div class="task-actions">
      <button data-act="edit" aria-label="Edit"><i data-lucide="pencil"></i></button>
      <button data-act="duplicate" aria-label="Duplicate"><i data-lucide="copy"></i></button>
      <button data-act="delete" aria-label="Delete"><i data-lucide="trash-2"></i></button>
    </div>
  `;
  return li;
}
/* ===================================================================
   GLOBAL SEARCH
   =================================================================== */
function bindSearch() {
  $('#globalSearch')?.addEventListener('input', debounce(() => {
    renderAll();
    renderFlashcards();
  }, 150));
}
/* ===================================================================
   FLASHCARDS
   =================================================================== */
function bindFlashcards() {
  $('#addFlashcardBtn').addEventListener('click', () => openFlashModal({}));
  $('#flashForm').addEventListener('submit', (e) => {
    e.preventDefault();
    saveFlashcardFromForm();
  });
  $('#flashSearch').addEventListener('input', renderFlashcards);
  $('#flashFilter').addEventListener('change', renderFlashcards);
  document.addEventListener('click', (e) => {
    const card = e.target.closest('.flash-card');
    if (!card) return;
    const id = card.dataset.id;
    const c = FlashStore.all().find((x) => x.id === id);
    if (!c) return;
    if (e.target.closest('[data-fact="edit"]')) openFlashModal(c);
    else if (e.target.closest('[data-fact="delete"]')) { FlashStore.remove(id); renderFlashcards(); }
    else if (e.target.closest('[data-fact="pin"]')) { FlashStore.update(id, { pinned: !c.pinned }); renderFlashcards(); }
    else if (e.target.closest('[data-fact="fav"]')) { FlashStore.update(id, { favorite: !c.favorite }); renderFlashcards(); }
  });
  renderFlashcards();
}
function openFlashModal(data = {}) {
  $('#flashId').value = data.id || '';
  $('#flashTitle').value = data.title || '';
  $('#flashCategory').value = data.category || '';
  $('#flashDesc').value = data.description || '';
  $('#flashTags').value = (data.tags || []).join(', ');
  $('#flashColor').value = data.color || '#7dbfa0';
  openModal('flashModal');
  setTimeout(() => $('#flashTitle').focus(), 50);
}
function saveFlashcardFromForm() {
  const id = $('#flashId').value;
  const payload = {
    title: $('#flashTitle').value.trim(),
    category: $('#flashCategory').value.trim(),
    description: $('#flashDesc').value.trim(),
    tags: $('#flashTags').value.split(',').map((s) => s.trim()).filter(Boolean),
    color: $('#flashColor').value,
  };
  if (id) FlashStore.update(id, payload);
  else FlashStore.add({ id: uid(), createdAt: Date.now(), pinned: false, favorite: false, ...payload });
  closeModal('flashModal');
  renderFlashcards();
}
function renderFlashcards() {
  const grid = $('#flashGrid');
  if (!grid) return;
  const q = ($('#flashSearch').value || '').toLowerCase().trim();
  const gq = ($('#globalSearch')?.value || '').toLowerCase().trim();
  const filter = $('#flashFilter').value;
  let cards = FlashStore.all();
  if (filter === 'pinned') cards = cards.filter((c) => c.pinned);
  if (filter === 'favorite') cards = cards.filter((c) => c.favorite);
  if (q || gq) {
    const needle = q || gq;
    cards = cards.filter((c) => [c.title, c.description, c.category, (c.tags || []).join(' ')].join(' ').toLowerCase().includes(needle));
  }
  cards.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
  if (!cards.length) {
    grid.innerHTML = `<p class="muted">No flashcards yet — press "New Flashcard" to add one.</p>`;
    return;
  }
  grid.innerHTML = cards.map((c) => `
    <article class="flash-card ${c.pinned ? 'pinned' : ''}" data-id="${c.id}" style="border-top-color:${c.color}">
      <div class="cat">${escapeHtml(c.category || 'General')}</div>
      <h4>${escapeHtml(c.title)}</h4>
      <p>${escapeHtml(c.description)}</p>
      <div class="tags">${(c.tags || []).map((t) => `<span class="tag">#${escapeHtml(t)}</span>`).join('')}</div>
      <div class="flash-actions">
        <button data-fact="fav" class="fav ${c.favorite ? 'on' : ''}">♥ Favorite</button>
        <button data-fact="pin">📌 ${c.pinned ? 'Unpin' : 'Pin'}</button>
        <button data-fact="edit">Edit</button>
        <button data-fact="delete">Delete</button>
      </div>
    </article>
  `).join('');
}
/* ===================================================================
   SETTINGS
   =================================================================== */
function bindSettings() {
  const s = SettingsStore.get();
  $('#fontSize').value = s.fontSize;
  $('#cardSize').value = s.cardSize;
  $('#animSpeed').value = s.animSpeed;
  $('#bgBlur').value = s.bgBlur;
  $('#accent').value = s.accent;
  $$('[data-theme]').forEach((b) => b.addEventListener('click', () => {
    SettingsStore.set({ theme: b.dataset.theme });
    Theme.apply(SettingsStore.get());
  }));
  const bindRange = (id, key, cast = Number) => {
    $('#' + id).addEventListener('input', (e) => {
      SettingsStore.set({ [key]: cast(e.target.value) });
      Theme.apply(SettingsStore.get());
    });
  };
  bindRange('fontSize', 'fontSize');
  bindRange('cardSize', 'cardSize');
  bindRange('animSpeed', 'animSpeed');
  bindRange('bgBlur', 'bgBlur');
  $('#accent').addEventListener('input', (e) => {
    SettingsStore.set({ accent: e.target.value });
    Theme.apply(SettingsStore.get());
  });
  $('#exportBtn').addEventListener('click', () => {
    const data = {
      tasks: TaskStore.all(),
      flashcards: FlashStore.all(),
      settings: SettingsStore.get(),
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'natureflow-export.json'; a.click();
    URL.revokeObjectURL(url);
  });
  $('#clearBtn').addEventListener('click', () => {
    if (confirm('Delete ALL tasks, flashcards, and settings? This cannot be undone.')) {
      Storage.clearAll();
      location.reload();
    }
  });
}
/* ===================================================================
   ESCAPING / CSS HELPERS
   =================================================================== */
function escapeHtml(s = '') {
  return String(s).replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[m]));
}
/* ===========================================
   NODE/TEST EXPORTS
   Only defined under a CommonJS module system (node:test).
   Browser behavior above is unchanged.
   =========================================== */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { debounce, matchesSearch, escapeHtml };
}
