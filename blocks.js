/* ===================================================================
   BLOCKS.JS — Fully customizable Block & Category system
   Extends NatureFlow Planner without redesigning the UI.
   Depends on: storage.js (TaskStore, Storage), script.js (renderAll)
   Data model (localStorage key: nf_blocks_v1):
     {
       version: 1,
       blocks: [
         { id, name, icon, color, collapsed,
           categories: [ { id, name, icon, color, collapsed } ] }
       ]
     }
   Tasks continue to use the existing shape { block, section, ... }
   where `block` is a Block id and `section` is a Category name.
   =================================================================== */
(function () {
  'use strict';
  /* ================================================================
     STORAGE + CONSTANTS
     ================================================================ */
  const BLOCKS_KEY = 'nf_blocks_v1';
  const MIGRATION_KEY = 'nf_blocks_migration_v1';
  const CURRENT_VERSION = 1;
  const DEFAULT_BLOCK_COLOR  = '#4f9d7d';
  const DEFAULT_CAT_COLOR    = '#7dbfa0';
  const DEFAULT_BLOCK_ICON   = 'folder';
  const DEFAULT_CAT_ICON     = 'tag';
  /* Preserved sidebar nav items — never touched by this module. */
  const PRESERVED_VIEWS = new Set(['dashboard', 'flashcards', 'settings']);
  /* Legacy hardcoded blocks used purely for one-time migration of
     existing user data. Nothing here is shown to new users. */
  const LEGACY_LAYOUT = [
    { id: 'primary',   name: 'Primary Work',            icon: 'palette',       categories: ['Art', 'Animation', 'Design'] },
    { id: 'projects',  name: 'Projects',                icon: 'folder-kanban', categories: ['Personal Project', 'Indie Game Development'] },
    { id: 'marketing', name: 'Marketing',               icon: 'megaphone',     categories: ['My Community'] },
    { id: 'business',  name: 'Business / Client Work',  icon: 'briefcase',     categories: ['Business', 'Client Work'] },
    { id: 'secondary', name: 'Secondary Work',          icon: 'book-open',     categories: ['English Language', 'Programming', 'Game Development', 'Nature / Space / Sci-Fi / Biology'] },
    { id: 'soft',      name: 'Soft Skills',             icon: 'sparkles',      categories: ['Soft Skills'] },
    { id: 'random',    name: 'Random Todo',             icon: 'list-todo',     categories: ['Random'] },
  ];
  /* ================================================================
     UTILITIES
     ================================================================ */
  const $  = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  const escapeHtml = (s = '') => String(s).replace(/[&<>"']/g, (m) => (
    { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const cssEscape = (s = '') => String(s).replace(/"/g, '\\"');
  /* ================================================================
     STORE
     ================================================================ */
  const BlockStore = {
    _cache: null,
    load() {
      if (this._cache) return this._cache;
      const raw = Storage.read(BLOCKS_KEY, null);
      this._cache = raw && Array.isArray(raw.blocks)
        ? raw
        : { version: CURRENT_VERSION, blocks: [] };
      return this._cache;
    },
    save() {
      Storage.write(BLOCKS_KEY, this._cache);
    },
    all() { return this.load().blocks; },
    /* ---------- Block CRUD ---------- */
    addBlock(patch) {
      const b = {
        id: uid(),
        name: patch.name || 'Untitled Block',
        icon: patch.icon || defaultBlockIcon(),
        color: patch.color || defaultBlockColor(),
        collapsed: false,
        categories: [],
      };
      this.load().blocks.push(b);
      this.save();
      return b;
    },
    updateBlock(id, patch) {
      const b = this.all().find((x) => x.id === id);
      if (!b) return;
      Object.assign(b, patch);
      this.save();
    },
    removeBlock(id, { moveTo } = {}) {
      const state = this.load();
      const block = state.blocks.find((b) => b.id === id);
      if (!block) return;
      if (moveTo) {
        const target = state.blocks.find((b) => b.id === moveTo);
        if (target) {
          // Move categories; rename on collision.
          for (const cat of block.categories) {
            let name = cat.name;
            let n = 2;
            while (target.categories.some((c) => c.name === name)) {
              name = `${cat.name} (${n++})`;
            }
            // Update task references from oldBlockId/oldCatName -> newBlockId/newName
            reassignTasks(id, cat.name, moveTo, name);
            target.categories.push({ ...cat, name });
          }
        } else {
          // Target vanished — fall through to delete tasks.
          deleteTasksInBlock(id);
        }
      } else {
        deleteTasksInBlock(id);
      }
      state.blocks = state.blocks.filter((b) => b.id !== id);
      this.save();
    },
    duplicateBlock(id) {
      const b = this.all().find((x) => x.id === id);
      if (!b) return null;
      const copy = {
        ...b,
        id: uid(),
        name: `${b.name} (copy)`,
        categories: b.categories.map((c) => ({ ...c, id: uid() })),
      };
      this.load().blocks.push(copy);
      this.save();
      return copy;
    },
    reorderBlocks(orderIds) {
      const state = this.load();
      const byId = new Map(state.blocks.map((b) => [b.id, b]));
      state.blocks = orderIds.map((id) => byId.get(id)).filter(Boolean)
        .concat(state.blocks.filter((b) => !orderIds.includes(b.id)));
      this.save();
    },
    /* ---------- Category CRUD ---------- */
    addCategory(blockId, patch) {
      const b = this.all().find((x) => x.id === blockId);
      if (!b) return null;
      const name = uniqueCategoryName(b, patch.name || 'Untitled');
      const c = {
        id: uid(),
        name,
        icon: patch.icon || defaultCatIcon(),
        color: patch.color || defaultCatColor(),
        collapsed: false,
      };
      b.categories.push(c);
      this.save();
      return c;
    },
    updateCategory(blockId, catId, patch) {
      const b = this.all().find((x) => x.id === blockId);
      if (!b) return;
      const c = b.categories.find((x) => x.id === catId);
      if (!c) return;
      // Rename: propagate to tasks, and enforce uniqueness within block.
      if (patch.name && patch.name !== c.name) {
        const oldName = c.name;
        const newName = uniqueCategoryName(b, patch.name, catId);
        renameTaskSection(blockId, oldName, newName);
        c.name = newName;
      }
      for (const k of ['icon', 'color', 'collapsed']) {
        if (k in patch) c[k] = patch[k];
      }
      this.save();
    },
    removeCategory(blockId, catId, { moveTo } = {}) {
      const b = this.all().find((x) => x.id === blockId);
      if (!b) return;
      const cat = b.categories.find((x) => x.id === catId);
      if (!cat) return;
      if (moveTo) {
        const [targetBlockId, targetCatId] = moveTo.split('::');
        const tb = this.all().find((x) => x.id === targetBlockId);
        const tc = tb && tb.categories.find((x) => x.id === targetCatId);
        if (tb && tc) {
          reassignTasks(blockId, cat.name, targetBlockId, tc.name);
        } else {
          deleteTasksInCategory(blockId, cat.name);
        }
      } else {
        deleteTasksInCategory(blockId, cat.name);
      }
      b.categories = b.categories.filter((c) => c.id !== catId);
      this.save();
    },
    duplicateCategory(blockId, catId) {
      const b = this.all().find((x) => x.id === blockId);
      if (!b) return null;
      const c = b.categories.find((x) => x.id === catId);
      if (!c) return null;
      const copy = { ...c, id: uid(), name: uniqueCategoryName(b, `${c.name} (copy)`) };
      b.categories.push(copy);
      this.save();
      return copy;
    },
    reorderCategories(blockId, orderIds) {
      const b = this.all().find((x) => x.id === blockId);
      if (!b) return;
      const byId = new Map(b.categories.map((c) => [c.id, c]));
      b.categories = orderIds.map((id) => byId.get(id)).filter(Boolean)
        .concat(b.categories.filter((c) => !orderIds.includes(c.id)));
      this.save();
    },
    moveCategory(fromBlockId, catId, toBlockId) {
      if (fromBlockId === toBlockId) return;
      const from = this.all().find((x) => x.id === fromBlockId);
      const to   = this.all().find((x) => x.id === toBlockId);
      if (!from || !to) return;
      const cat = from.categories.find((c) => c.id === catId);
      if (!cat) return;
      const newName = uniqueCategoryName(to, cat.name);
      reassignTasks(fromBlockId, cat.name, toBlockId, newName);
      from.categories = from.categories.filter((c) => c.id !== catId);
      to.categories.push({ ...cat, name: newName });
      this.save();
    },
  };
  /* ================================================================
     TASK HELPERS — keep task data in sync with block/category changes
     ================================================================ */
  function reassignTasks(oldBlockId, oldSection, newBlockId, newSection) {
    const tasks = TaskStore.all().map((t) =>
      (t.block === oldBlockId && t.section === oldSection)
        ? { ...t, block: newBlockId, section: newSection }
        : t);
    TaskStore.save(tasks);
  }
  function renameTaskSection(blockId, oldName, newName) {
    reassignTasks(blockId, oldName, blockId, newName);
  }
  function deleteTasksInBlock(blockId) {
    TaskStore.save(TaskStore.all().filter((t) => t.block !== blockId));
  }
  function deleteTasksInCategory(blockId, section) {
    TaskStore.save(TaskStore.all().filter((t) => !(t.block === blockId && t.section === section)));
  }
  function uniqueCategoryName(block, desired, ignoreCatId = null) {
    let name = desired.trim() || 'Untitled';
    const taken = new Set(block.categories.filter((c) => c.id !== ignoreCatId).map((c) => c.name));
    if (!taken.has(name)) return name;
    let n = 2;
    while (taken.has(`${name} (${n})`)) n++;
    return `${name} (${n})`;
  }
  function defaultBlockColor() {
    return (window.SettingsStore && SettingsStore.get().defaultBlockColor) || DEFAULT_BLOCK_COLOR;
  }
  function defaultCatColor() {
    return (window.SettingsStore && SettingsStore.get().defaultCategoryColor) || DEFAULT_CAT_COLOR;
  }
  function defaultBlockIcon() {
    return (window.SettingsStore && SettingsStore.get().defaultBlockIcon) || DEFAULT_BLOCK_ICON;
  }
  function defaultCatIcon() {
    return (window.SettingsStore && SettingsStore.get().defaultCategoryIcon) || DEFAULT_CAT_ICON;
  }
  /* ================================================================
     MIGRATION — one-time conversion of legacy hardcoded blocks
     ================================================================ */
  function migrateIfNeeded() {
    const done = Storage.read(MIGRATION_KEY, 0);
    if (done >= CURRENT_VERSION) return;
    const state = BlockStore.load();
    const hasBlocks = state.blocks.length > 0;
    const hasTasks  = (TaskStore.all() || []).length > 0;
    if (!hasBlocks && hasTasks) {
      // Recreate legacy layout to preserve existing tasks in-place.
      state.blocks = LEGACY_LAYOUT.map((b) => ({
        id: b.id,
        name: b.name,
        icon: b.icon,
        color: DEFAULT_BLOCK_COLOR,
        collapsed: false,
        categories: b.categories.map((name) => ({
          id: uid(),
          name,
          icon: DEFAULT_CAT_ICON,
          color: DEFAULT_CAT_COLOR,
          collapsed: false,
        })),
      }));
      BlockStore.save();
    }
    Storage.write(MIGRATION_KEY, CURRENT_VERSION);
  }
  /* ================================================================
     DOM — strip legacy hardcoded nav items and views
     ================================================================ */
  function stripLegacyDom() {
    $$('.sidebar .nav .nav-item').forEach((btn) => {
      if (!PRESERVED_VIEWS.has(btn.dataset.view)) btn.remove();
    });
    $$('.view').forEach((v) => {
      const id = v.id.replace(/^view-/, '');
      if (!PRESERVED_VIEWS.has(id)) v.remove();
    });
  }
  /* ================================================================
     DOM — render sidebar nav items + Add Block button
     ================================================================ */
  function renderSidebar() {
    const nav = $('.sidebar .nav');
    if (!nav) return;
    // Remove anything we injected previously.
    $$('.nav-item.nf-block-nav', nav).forEach((n) => n.remove());
    $('#nfAddBlockBtn')?.remove();
    const dashboard = nav.querySelector('.nav-item[data-view="dashboard"]');
    const flash     = nav.querySelector('.nav-item[data-view="flashcards"]');
    const anchor = flash || nav.querySelector('.nav-item[data-view="settings"]') || null;
    const blocks = BlockStore.all();
    for (const b of blocks) {
      const el = document.createElement('button');
      el.className = 'nav-item nf-block-nav';
      el.dataset.view = 'block-' + b.id;
      el.dataset.blockId = b.id;
      el.draggable = true;
      el.title = b.name;
      el.innerHTML = `
        <i data-lucide="${escapeHtml(b.icon || DEFAULT_BLOCK_ICON)}" style="color:${escapeHtml(b.color || DEFAULT_BLOCK_COLOR)}"></i>
        <span>${escapeHtml(b.name)}</span>
      `;
      nav.insertBefore(el, anchor);
    }
    // "Add Block" button (uses existing .nav-item styling for identical look)
    const add = document.createElement('button');
    add.className = 'nav-item';
    add.id = 'nfAddBlockBtn';
    add.type = 'button';
    add.innerHTML = `<i data-lucide="plus-circle"></i><span>Add Block</span>`;
    nav.insertBefore(add, anchor);
    if (window.lucide) window.lucide.createIcons();
  }
  /* ================================================================
     DOM — render one <section class="view"> per block
     ================================================================ */
  function renderViews() {
    const main = $('.main');
    if (!main) return;
    // Remove previously injected views.
    $$('.view.nf-block-view', main).forEach((v) => v.remove());
    const blocks = BlockStore.all();
    // Empty-state view when no blocks exist AT ALL.
    let empty = $('#view-nf-empty');
    if (!blocks.length) {
      if (!empty) {
        empty = document.createElement('section');
        empty.className = 'view nf-block-view';
        empty.id = 'view-nf-empty';
        empty.innerHTML = `
          <div class="view-head"><h2>Welcome 🌿</h2><p class="muted">Your planner is empty.</p></div>
          <div class="glass panel" style="text-align:center;padding:40px 24px;">
            <p style="margin-bottom:16px;">Create your first Block to begin organizing your planner.</p>
            <button class="btn primary" id="nfEmptyCreateBtn"><i data-lucide="plus"></i> Create Block</button>
          </div>`;
        main.appendChild(empty);
      }
    } else if (empty) {
      empty.remove();
    }
    for (const b of blocks) {
      const section = document.createElement('section');
      section.className = 'view nf-block-view';
      section.id = 'view-block-' + b.id;
      section.dataset.blockId = b.id;
      section.innerHTML = viewHtml(b);
      main.appendChild(section);
    }
    if (window.lucide) window.lucide.createIcons();
  }
  function viewHtml(b) {
    const cats = b.categories || [];
    const gridClass = cats.length === 1 ? 'sections-grid one'
                    : cats.length === 2 ? 'sections-grid two'
                    : 'sections-grid';
    const catPanels = cats.length ? cats.map((c) => catPanelHtml(b, c)).join('') : `
      <div class="glass panel" style="text-align:center;padding:24px;">
        <p class="muted" style="margin-bottom:12px;">No categories yet.</p>
        <button class="btn primary nf-add-category" data-block-id="${b.id}"><i data-lucide="plus"></i> Add Category</button>
      </div>`;
    return `
      <div class="view-head" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
        <div>
          <h2 style="display:flex;align-items:center;gap:8px;">
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${escapeHtml(b.color)};"></span>
            ${escapeHtml(b.name)}
          </h2>
          <p class="muted">Your custom block.</p>
        </div>
        <div class="btn-group" style="display:flex;gap:8px;">
          <button class="btn primary nf-add-category" data-block-id="${b.id}"><i data-lucide="plus"></i> Add Category</button>
          <button class="btn ghost nf-block-menu" data-block-id="${b.id}" aria-label="Block options"><i data-lucide="more-horizontal"></i></button>
        </div>
      </div>
      <div class="${gridClass}" data-block="${b.id}" data-block-grid="${b.id}">
        ${catPanels}
      </div>`;
  }
  function catPanelHtml(b, c) {
    return `
      <div class="glass panel section-panel nf-cat-panel"
           data-section="${escapeHtml(c.name)}"
           data-cat-id="${c.id}"
           data-block-id="${b.id}"
           draggable="true"
           style="border-top:3px solid ${escapeHtml(c.color)};">
        <div class="panel-head" style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <h3 style="display:flex;align-items:center;gap:6px;">
            <i data-lucide="${escapeHtml(c.icon || DEFAULT_CAT_ICON)}" style="color:${escapeHtml(c.color)}"></i>
            ${escapeHtml(c.name)}
          </h3>
          <div style="display:flex;gap:4px;">
            <button class="btn-mini add-task" data-block="${b.id}" data-section="${escapeHtml(c.name)}"><i data-lucide="plus"></i>Add</button>
            <button class="btn-mini nf-cat-menu" data-block-id="${b.id}" data-cat-id="${c.id}" aria-label="Category options"><i data-lucide="more-horizontal"></i></button>
          </div>
        </div>
        <ul class="task-list" data-list="${cssEscape(b.id)}::${cssEscape(c.name)}"></ul>
      </div>`;
  }
  /* ================================================================
     NAVIGATION — delegated click so dynamic items work
     ================================================================ */
  function bindDelegatedNav() {
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item[data-view]');
      if (!btn) return;
      // Skip if it targets a preserved (built-in) view — script.js already
      // handles those via its own listener.
      const view = btn.dataset.view;
      if (PRESERVED_VIEWS.has(view)) return;
      $$('.nav-item').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      $$('.view').forEach((v) => v.classList.remove('active'));
      const target = document.getElementById('view-' + view) || $('#view-nf-empty');
      if (target) target.classList.add('active');
      $('#sidebar')?.classList.remove('open');
    });
  }
  /* ================================================================
     MODAL — Block create / edit
     ================================================================ */
  function openBlockModal(existing) {
    const isEdit = !!existing;
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="glass modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${isEdit ? 'Edit Block' : 'New Block'}</h3>
          <button class="icon-btn" data-cancel aria-label="Close"><i data-lucide="x"></i></button>
        </div>
        <form class="modal-body">
          <label>Block name<input type="text" name="name" required maxlength="60" value="${escapeHtml(existing?.name || '')}" /></label>
          <div class="row-2">
            <label>Icon (lucide name)
              <input type="text" name="icon" placeholder="folder, star, book…" value="${escapeHtml(existing?.icon || defaultBlockIcon())}" />
            </label>
            <label>Color
              <input type="color" name="color" value="${escapeHtml(existing?.color || defaultBlockColor())}" />
            </label>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-cancel>Cancel</button>
            <button type="submit" class="btn primary">${isEdit ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(bd);
    if (window.lucide) window.lucide.createIcons();
    setTimeout(() => bd.querySelector('input[name="name"]').focus(), 30);
    bd.addEventListener('click', (e) => {
      if (e.target.matches('[data-cancel]') || e.target.closest('[data-cancel]') || e.target === bd) bd.remove();
    });
    bd.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const patch = {
        name: String(fd.get('name') || '').trim(),
        icon: String(fd.get('icon') || '').trim() || defaultBlockIcon(),
        color: String(fd.get('color') || '') || defaultBlockColor(),
      };
      if (!patch.name) return;
      let block;
      if (isEdit) { BlockStore.updateBlock(existing.id, patch); block = existing; }
      else       { block = BlockStore.addBlock(patch); }
      bd.remove();
      refreshAll();
      if (block) activateView('block-' + block.id);
    });
  }
  /* ================================================================
     MODAL — Category create / edit
     ================================================================ */
  function openCategoryModal(blockId, existing) {
    const isEdit = !!existing;
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="glass modal" role="dialog" aria-modal="true">
        <div class="modal-head">
          <h3>${isEdit ? 'Edit Category' : 'New Category'}</h3>
          <button class="icon-btn" data-cancel aria-label="Close"><i data-lucide="x"></i></button>
        </div>
        <form class="modal-body">
          <label>Category name<input type="text" name="name" required maxlength="60" value="${escapeHtml(existing?.name || '')}" /></label>
          <div class="row-2">
            <label>Icon (lucide name)
              <input type="text" name="icon" placeholder="tag, book, code…" value="${escapeHtml(existing?.icon || defaultCatIcon())}" />
            </label>
            <label>Color
              <input type="color" name="color" value="${escapeHtml(existing?.color || defaultCatColor())}" />
            </label>
          </div>
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-cancel>Cancel</button>
            <button type="submit" class="btn primary">${isEdit ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </div>`;
    document.body.appendChild(bd);
    if (window.lucide) window.lucide.createIcons();
    setTimeout(() => bd.querySelector('input[name="name"]').focus(), 30);
    bd.addEventListener('click', (e) => {
      if (e.target.matches('[data-cancel]') || e.target.closest('[data-cancel]') || e.target === bd) bd.remove();
    });
    bd.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.currentTarget);
      const patch = {
        name: String(fd.get('name') || '').trim(),
        icon: String(fd.get('icon') || '').trim() || defaultCatIcon(),
        color: String(fd.get('color') || '') || defaultCatColor(),
      };
      if (!patch.name) return;
      if (isEdit) BlockStore.updateCategory(blockId, existing.id, patch);
      else        BlockStore.addCategory(blockId, patch);
      bd.remove();
      refreshAll();
    });
  }
  /* ================================================================
     CONTEXT MENU (three-dots) for blocks
     ================================================================ */
  function openBlockMenu(blockId, anchor) {
    const b = BlockStore.all().find((x) => x.id === blockId);
    if (!b) return;
    showPopup(anchor, [
      { label: 'Rename / Edit', on: () => openBlockModal(b) },
      { label: 'Duplicate',     on: () => { BlockStore.duplicateBlock(blockId); refreshAll(); } },
      { label: 'Delete…',       on: () => confirmDeleteBlock(b), danger: true },
    ]);
  }
  function openCategoryMenu(blockId, catId, anchor) {
    const b = BlockStore.all().find((x) => x.id === blockId);
    const c = b && b.categories.find((x) => x.id === catId);
    if (!c) return;
    showPopup(anchor, [
      { label: 'Rename / Edit', on: () => openCategoryModal(blockId, c) },
      { label: 'Duplicate',     on: () => { BlockStore.duplicateCategory(blockId, catId); refreshAll(); } },
      { label: 'Move to block…', on: () => moveCategoryPrompt(blockId, catId) },
      { label: 'Delete…',       on: () => confirmDeleteCategory(blockId, c), danger: true },
    ]);
  }
  function showPopup(anchor, items) {
    document.getElementById('nf-popup')?.remove();
    const rect = anchor.getBoundingClientRect();
    const el = document.createElement('div');
    el.id = 'nf-popup';
    el.className = 'nf-popup';
    el.style.cssText = `position:fixed;top:${rect.bottom + 4}px;left:${Math.max(8, rect.right - 180)}px;z-index:9999;background:var(--panel,rgba(255,255,255,.98));backdrop-filter:blur(10px);border-radius:10px;padding:6px;box-shadow:0 12px 32px rgba(0,0,0,.2);min-width:180px;`;
    el.innerHTML = items.map((it, i) => `
      <button data-i="${i}" style="display:block;width:100%;text-align:left;background:transparent;border:0;padding:8px 12px;border-radius:6px;cursor:pointer;font:inherit;color:${it.danger ? '#c86464' : 'inherit'};">${escapeHtml(it.label)}</button>
    `).join('');
    document.body.appendChild(el);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      const it = items[Number(b.dataset.i)];
      el.remove();
      it.on();
    });
    setTimeout(() => {
      const dismiss = (e) => { if (!el.contains(e.target)) { el.remove(); document.removeEventListener('click', dismiss, true); } };
      document.addEventListener('click', dismiss, true);
    }, 0);
  }
  /* ================================================================
     DELETE CONFIRMATIONS with move-to option
     ================================================================ */
  function confirmDeleteBlock(block) {
    const others = BlockStore.all().filter((b) => b.id !== block.id);
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="glass modal" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>Delete block?</h3></div>
        <div class="modal-body">
          <p>Delete <strong>${escapeHtml(block.name)}</strong> and everything inside it, or move its categories to another block first?</p>
          ${others.length ? `<label>Move categories to
            <select name="moveTo">
              <option value="">— Delete block and all its tasks —</option>
              ${others.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}
            </select></label>` : `<p class="muted">No other blocks exist — all tasks in this block will be deleted.</p>`}
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-cancel>Cancel</button>
            <button type="button" class="btn primary" data-confirm>Delete</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(bd);
    bd.addEventListener('click', (e) => {
      if (e.target.matches('[data-cancel]') || e.target === bd) bd.remove();
      else if (e.target.matches('[data-confirm]')) {
        const moveTo = bd.querySelector('[name="moveTo"]')?.value || null;
        BlockStore.removeBlock(block.id, { moveTo });
        bd.remove();
        // Go back to dashboard if we deleted the active view.
        activateView('dashboard');
        refreshAll();
      }
    });
  }
  function confirmDeleteCategory(blockId, cat) {
    const targets = [];
    for (const b of BlockStore.all()) {
      for (const c of b.categories) {
        if (b.id === blockId && c.id === cat.id) continue;
        targets.push({ id: `${b.id}::${c.id}`, label: `${b.name} / ${c.name}` });
      }
    }
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="glass modal" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>Delete category?</h3></div>
        <div class="modal-body">
          <p>Delete <strong>${escapeHtml(cat.name)}</strong>, or move its tasks to another category first?</p>
          ${targets.length ? `<label>Move tasks to
            <select name="moveTo">
              <option value="">— Delete category and its tasks —</option>
              ${targets.map((t) => `<option value="${t.id}">${escapeHtml(t.label)}</option>`).join('')}
            </select></label>` : `<p class="muted">No other categories exist — tasks in this category will be deleted.</p>`}
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-cancel>Cancel</button>
            <button type="button" class="btn primary" data-confirm>Delete</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(bd);
    bd.addEventListener('click', (e) => {
      if (e.target.matches('[data-cancel]') || e.target === bd) bd.remove();
      else if (e.target.matches('[data-confirm]')) {
        const moveTo = bd.querySelector('[name="moveTo"]')?.value || null;
        BlockStore.removeCategory(blockId, cat.id, { moveTo });
        bd.remove();
        refreshAll();
      }
    });
  }
  function moveCategoryPrompt(blockId, catId) {
    const others = BlockStore.all().filter((b) => b.id !== blockId);
    if (!others.length) return;
    const bd = document.createElement('div');
    bd.className = 'modal-backdrop';
    bd.innerHTML = `
      <div class="glass modal" role="dialog" aria-modal="true">
        <div class="modal-head"><h3>Move category</h3></div>
        <div class="modal-body">
          <label>Destination block
            <select name="dst">${others.map((o) => `<option value="${o.id}">${escapeHtml(o.name)}</option>`).join('')}</select>
          </label>
          <div class="modal-actions">
            <button type="button" class="btn ghost" data-cancel>Cancel</button>
            <button type="button" class="btn primary" data-confirm>Move</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(bd);
    bd.addEventListener('click', (e) => {
      if (e.target.matches('[data-cancel]') || e.target === bd) bd.remove();
      else if (e.target.matches('[data-confirm]')) {
        const dst = bd.querySelector('[name="dst"]').value;
        BlockStore.moveCategory(blockId, catId, dst);
        bd.remove();
        refreshAll();
      }
    });
  }
  /* ================================================================
     DRAG & DROP — blocks in sidebar + categories in views
     Task DnD (script.js) uses 'text/plain' — we use distinct MIME types
     so behaviors don't clash.
     ================================================================ */
  const MIME_BLOCK = 'application/x-nf-block';
  const MIME_CAT   = 'application/x-nf-category';
  function bindDragAndDrop() {
    /* --- Blocks in sidebar --- */
    const nav = $('.sidebar .nav');
    if (nav) {
      nav.addEventListener('dragstart', (e) => {
        const item = e.target.closest('.nav-item.nf-block-nav');
        if (!item) return;
        e.dataTransfer.setData(MIME_BLOCK, item.dataset.blockId);
        e.dataTransfer.effectAllowed = 'move';
        item.classList.add('dragging');
      });
      nav.addEventListener('dragend', (e) => {
        e.target.closest('.nav-item')?.classList.remove('dragging');
      });
      nav.addEventListener('dragover', (e) => {
        if (!Array.from(e.dataTransfer.types).includes(MIME_BLOCK)) return;
        const over = e.target.closest('.nav-item.nf-block-nav');
        if (!over) return;
        e.preventDefault();
      });
      nav.addEventListener('drop', (e) => {
        const id = e.dataTransfer.getData(MIME_BLOCK);
        if (!id) return;
        const over = e.target.closest('.nav-item.nf-block-nav');
        if (!over) return;
        e.preventDefault();
        const ids = $$('.nav-item.nf-block-nav', nav).map((n) => n.dataset.blockId);
        const from = ids.indexOf(id);
        const to   = ids.indexOf(over.dataset.blockId);
        if (from < 0 || to < 0 || from === to) return;
        ids.splice(from, 1);
        ids.splice(to, 0, id);
        BlockStore.reorderBlocks(ids);
        refreshAll();
      });
    }
    /* --- Categories inside a view (reorder + cross-block move) --- */
    document.addEventListener('dragstart', (e) => {
      const panel = e.target.closest('.nf-cat-panel');
      if (!panel) return;
      // Ignore if this drag originated inside a task element.
      if (e.target.closest('.task')) return;
      e.dataTransfer.setData(MIME_CAT, `${panel.dataset.blockId}::${panel.dataset.catId}`);
      e.dataTransfer.effectAllowed = 'move';
      panel.classList.add('dragging');
    });
    document.addEventListener('dragend', (e) => {
      e.target.closest?.('.nf-cat-panel')?.classList.remove('dragging');
    });
    document.addEventListener('dragover', (e) => {
      if (!e.dataTransfer || !Array.from(e.dataTransfer.types).includes(MIME_CAT)) return;
      const grid = e.target.closest('[data-block-grid]');
      if (!grid) return;
      e.preventDefault();
    });
    document.addEventListener('drop', (e) => {
      if (!e.dataTransfer) return;
      const payload = e.dataTransfer.getData(MIME_CAT);
      if (!payload) return;
      const grid = e.target.closest('[data-block-grid]');
      if (!grid) return;
      e.preventDefault();
      const [fromBlockId, catId] = payload.split('::');
      const toBlockId = grid.dataset.blockGrid;
      if (fromBlockId !== toBlockId) {
        BlockStore.moveCategory(fromBlockId, catId, toBlockId);
      } else {
        // Reorder within the same block.
        const overPanel = e.target.closest('.nf-cat-panel');
        const ids = $$('.nf-cat-panel', grid).map((p) => p.dataset.catId);
        const from = ids.indexOf(catId);
        const to   = overPanel ? ids.indexOf(overPanel.dataset.catId) : ids.length - 1;
        if (from < 0 || to < 0 || from === to) return;
        ids.splice(from, 1);
        ids.splice(to, 0, catId);
        BlockStore.reorderCategories(fromBlockId, ids);
      }
      refreshAll();
    });
  }
  /* ================================================================
     GLOBAL CLICK BINDINGS (add category, menus, empty-state)
     ================================================================ */
  function bindGlobalClicks() {
    document.addEventListener('click', (e) => {
      if (e.target.closest('#nfAddBlockBtn')) { openBlockModal(null); return; }
      if (e.target.closest('#nfEmptyCreateBtn')) { openBlockModal(null); return; }
      const addCat = e.target.closest('.nf-add-category');
      if (addCat) { openCategoryModal(addCat.dataset.blockId, null); return; }
      const bm = e.target.closest('.nf-block-menu');
      if (bm) { openBlockMenu(bm.dataset.blockId, bm); return; }
      const cm = e.target.closest('.nf-cat-menu');
      if (cm) { openCategoryMenu(cm.dataset.blockId, cm.dataset.catId, cm); return; }
    });
  }
  /* ================================================================
     ACTIVATE VIEW HELPER
     ================================================================ */
  function activateView(view) {
    $$('.nav-item').forEach((b) => b.classList.remove('active'));
    const nav = document.querySelector(`.nav-item[data-view="${view}"]`);
    nav?.classList.add('active');
    $$('.view').forEach((v) => v.classList.remove('active'));
    const target = document.getElementById('view-' + view)
      || (BlockStore.all().length === 0 ? $('#view-nf-empty') : null)
      || $('#view-dashboard');
    target?.classList.add('active');
  }
  /* ================================================================
     REFRESH — rebuild UI + delegate task rendering to script.js
     ================================================================ */
  function refreshAll() {
    // Preserve which view was active.
    const activeView = document.querySelector('.view.active')?.id;
    renderSidebar();
    renderViews();
    if (activeView) {
      const el = document.getElementById(activeView);
      if (el) { $$('.view').forEach((v) => v.classList.remove('active')); el.classList.add('active'); }
      else    { activateView(BlockStore.all().length ? 'block-' + BlockStore.all()[0].id : 'dashboard'); }
    }
    // Ask existing app to re-render tasks into our new lists.
    if (typeof window.renderAll === 'function') window.renderAll();
  }
  /* ================================================================
     SEARCH — extend global search to match block/category names
     ================================================================ */
  function bindSearchExtension() {
    const input = document.getElementById('globalSearch');
    if (!input) return;
    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      // Show/hide nav items whose block name matches
      $$('.nav-item.nf-block-nav').forEach((btn) => {
        if (!q) { btn.style.display = ''; return; }
        const b = BlockStore.all().find((x) => x.id === btn.dataset.blockId);
        const catMatch = b && b.categories.some((c) => c.name.toLowerCase().includes(q));
        btn.style.display = (b && (b.name.toLowerCase().includes(q) || catMatch)) ? '' : '';
      });
    });
  }
  /* ================================================================
     SETTINGS — extend Settings panel with defaults + reset layout
     ================================================================ */
  function injectSettings() {
    const panel = document.querySelector('#view-settings .settings-panel');
    if (!panel || document.getElementById('nf-blocks-settings')) return;
    const s = SettingsStore.get();
    const wrap = document.createElement('div');
    wrap.id = 'nf-blocks-settings';
    wrap.innerHTML = `
      <div class="setting-row">
        <label>Default block color</label>
        <input type="color" id="nfDefBlockColor" value="${escapeHtml(s.defaultBlockColor || DEFAULT_BLOCK_COLOR)}" />
      </div>
      <div class="setting-row">
        <label>Default category color</label>
        <input type="color" id="nfDefCatColor" value="${escapeHtml(s.defaultCategoryColor || DEFAULT_CAT_COLOR)}" />
      </div>
      <div class="setting-row">
        <label>Default block icon</label>
        <input type="text" id="nfDefBlockIcon" value="${escapeHtml(s.defaultBlockIcon || DEFAULT_BLOCK_ICON)}" placeholder="folder" />
      </div>
      <div class="setting-row">
        <label>Default category icon</label>
        <input type="text" id="nfDefCatIcon" value="${escapeHtml(s.defaultCategoryIcon || DEFAULT_CAT_ICON)}" placeholder="tag" />
      </div>
      <div class="setting-row">
        <label>Layout</label>
        <div class="btn-group">
          <button class="chip danger" id="nfResetLayout">Reset Layout</button>
        </div>
      </div>`;
    panel.appendChild(wrap);
    const set = (k, v) => SettingsStore.set({ [k]: v });
    $('#nfDefBlockColor').addEventListener('input', (e) => set('defaultBlockColor', e.target.value));
    $('#nfDefCatColor'  ).addEventListener('input', (e) => set('defaultCategoryColor', e.target.value));
    $('#nfDefBlockIcon' ).addEventListener('input', (e) => set('defaultBlockIcon', e.target.value.trim() || DEFAULT_BLOCK_ICON));
    $('#nfDefCatIcon'   ).addEventListener('input', (e) => set('defaultCategoryIcon', e.target.value.trim() || DEFAULT_CAT_ICON));
    $('#nfResetLayout').addEventListener('click', () => {
      if (!confirm('Reset ALL blocks & categories? Tasks will remain in storage but may be orphaned.')) return;
      BlockStore._cache = { version: CURRENT_VERSION, blocks: [] };
      BlockStore.save();
      refreshAll();
      activateView('dashboard');
    });
  }
  /* ================================================================
     BOOT
     ================================================================ */
  function boot() {
    if (typeof TaskStore === 'undefined' || typeof Storage === 'undefined') {
      console.warn('[blocks.js] storage.js not loaded — feature disabled.');
      return;
    }
    migrateIfNeeded();
    stripLegacyDom();
    renderSidebar();
    renderViews();
    bindDelegatedNav();
    bindGlobalClicks();
    bindDragAndDrop();
    bindSearchExtension();
    injectSettings();
    // Let existing script.js finish its own render, then rerun so tasks
    // populate into the newly injected lists.
    setTimeout(() => { if (typeof window.renderAll === 'function') window.renderAll(); }, 0);
    // Expose for debugging / integration.
    window.BlockStore = BlockStore;
    window.NFBlocks = {
      refreshAll,
      openBlockModal,
      openCategoryModal,
      // Called by backup.js after import: drop cache & rebuild sidebar/views.
      rebuild() { BlockStore._cache = null; refreshAll(); },
    };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
  