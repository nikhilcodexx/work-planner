# 🌿 NatureFlow Planner
A peaceful **anime + nature** themed personal productivity dashboard.
Manage learning, projects, business work, flashcards, and daily tasks — all in a calm, glassmorphic interface with an animated river landscape in the background.
Everything runs **entirely in your browser** using LocalStorage. No server, no accounts, no tracking.
---
## 📁 Folder Structure
```
NatureFlow-Planner/
├── index.html          # Markup & structure
├── style.css           # All styling (design tokens, glass, scene, responsive)
├── script.js           # App logic (tasks, flashcards, rendering, search)
├── storage.js          # LocalStorage abstraction
├── theme.js            # Theme + settings application
├── animation.js        # Ripple effects, micro-animations, tab-visibility pause
├── blocks.js            # Custom Blocks/Categories: create, rename, reorder, delete
├── backup.js            # Export / import / backup reminders, with v1→v2 migration
├── test/                # node:test unit + characterization tests (`npm test`)
├── docs/ENGINEERING-NOTES.md  # Why each perf/TDD fix in this branch was made
├── README.md
└── assets/
    ├── images/
    ├── icons/
    └── fonts/
```
## ✨ Features
- 🎋 Animated anime-nature background scene (river, character, forest, clouds, birds, leaves, fireflies at night) — respects `prefers-reduced-motion` and pauses while the tab is hidden
- 🧊 Glassmorphism cards with soft shadows
- ☀️ / 🌙 Light & Dark themes (Dark mode = night beside a peaceful river)
- 📋 Task manager with fully custom Blocks and Categories — create, rename, reorder, move, and delete your own (no hardcoded blocks)
- 🃏 Flashcards with tags, categories, colors, pin, favorite, search
- 🔍 Global search across tasks + flashcards (debounced)
- 🎯 Priorities: Low / Medium / High / Critical (each color-coded, Critical pulses)
- 🚀 Drag & Drop tasks between sections and blocks
- 📊 Live dashboard: today's tasks, completed, pending, progress %
- 💬 Daily quote
- ⏰ Live clock & date
- 💾 Everything auto-saves to LocalStorage
- 📥 Export / 📤 Import data as JSON (merge or replace), with periodic backup reminders
- ⚙️ Settings: theme, font size, card size, animation speed, background blur, accent color
- 📱 Fully responsive (desktop, laptop, tablet, mobile)
## 🚀 Installation
Just open `index.html` in your browser. That's it.
Optional — serve locally for the cleanest experience:
```bash
# with Python
python3 -m http.server 8000
# with Node
npx serve .
```
Then visit `http://localhost:8000`.
## ✅ Running the tests
```bash
npm test
```
Runs `node --test` (Node 18+, zero dependencies) over `test/`. See `docs/ENGINEERING-NOTES.md` for what's covered and why.
## 💾 How LocalStorage Works
All data is saved under these keys:
| Key                        | Contents                             |
| --------------------------- | ------------------------------------ |
| `nf_tasks_v1`               | Array of task objects                |
| `nf_flashcards_v1`          | Array of flashcard objects           |
| `nf_settings_v1`            | User settings (theme, sizes…)        |
| `nf_blocks_v1`               | Your custom Blocks/Categories tree   |
| `nf_last_backup_v1`         | Timestamp of the last export         |
Reload the page and everything is restored. Clearing browser storage (or the "Clear all" button in Settings) resets the app.
## 🎨 Customization
### Change colors
Edit CSS variables at the top of `style.css`:
```css
:root {
  --forest: #2f6b4f;
  --river-blue: #6fb3d0;
  --accent: #4f9d7d;
  /* … */
}
```
Or use **Settings → Accent color** in-app.
### Change theme
Toggle via the moon/sun icon in the top bar, or use **Settings → Theme**.
### Add a new block or category
Use the **Add Block** button in the sidebar, or the **+** control inside an existing block — this is handled entirely by `blocks.js` at runtime now, no HTML editing required.
### Change fonts
Swap the `<link>` in `index.html` for another Google Font and update `body { font-family: … }` in `style.css`.
## ♿ Accessibility
- Semantic HTML (`header`, `aside`, `main`, `section`, `article`, `nav`)
- ARIA labels on all icon-only buttons
- Keyboard-friendly focus states
- Good contrast in both themes
## 📜 License
MIT — free to use, modify, and share. Enjoy the calm 🌊