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
├── animation.js        # Ripple effects + micro-animations
├── README.md
└── assets/
    ├── images/
    ├── icons/
    └── fonts/
```
## ✨ Features
- 🎋 Animated anime-nature background scene (river, character, forest, clouds, birds, leaves, fireflies at night)
- 🧊 Glassmorphism cards with soft shadows
- ☀️ / 🌙 Light & Dark themes (Dark mode = night beside a peaceful river)
- 📋 Task manager across 7 blocks (Primary Work, Projects, Marketing, Business, Secondary Work, Soft Skills, Random Todo)
- 🃏 Flashcards with tags, categories, colors, pin, favorite, search
- 🔍 Global search across tasks + flashcards
- 🎯 Priorities: Low / Medium / High / Critical (each color-coded, Critical pulses)
- 🚀 Drag & Drop tasks between sections and blocks
- 📊 Live dashboard: today's tasks, completed, pending, progress %
- 💬 Daily quote
- ⏰ Live clock & date
- 💾 Everything auto-saves to LocalStorage
- 📥 Export data as JSON · 🗑️ Clear all data
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
## 💾 How LocalStorage Works
All data is saved under three keys:
| Key                 | Contents                       |
| ------------------- | ------------------------------ |
| `nf_tasks_v1`       | Array of task objects          |
| `nf_flashcards_v1`  | Array of flashcard objects     |
| `nf_settings_v1`    | User settings (theme, sizes…)  |
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
### Add a new block
1. In `index.html`, copy an existing `<section class="view" id="view-xxx">` block and rename it.
2. Add a matching `<button class="nav-item" data-view="xxx">` in the sidebar.
3. Inside your block, add section panels — each needs:
   - `<div class="panel section-panel" data-section="MyName">`
   - An `<button class="add-task" data-block="xxx" data-section="MyName">` button
   - A `<ul class="task-list" data-list="xxx::MyName"></ul>`
That's it — the app handles the rest automatically.
### Add a new section inside an existing block
Duplicate one of the `.section-panel` divs and change `data-section` + the matching `data-list` value. Format: `block::section`.
### Change fonts
Swap the `<link>` in `index.html` for another Google Font and update `body { font-family: … }` in `style.css`.
## ♿ Accessibility
- Semantic HTML (`header`, `aside`, `main`, `section`, `article`, `nav`)
- ARIA labels on all icon-only buttons
- Keyboard-friendly focus states
- Good contrast in both themes
## 📜 License
MIT — free to use, modify, and share. Enjoy the calm 🌊