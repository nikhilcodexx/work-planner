# Engineering Notes — perf/TDD cleanup branch

This document explains every change made on the `perf-audit-cleanup` branch,
and *why*, for whoever picks this project back up. It's written as a
mentoring exercise, not a changelog — the goal is that the reasoning
transfers to your next project, not just this one.

## 1. What was wrong, and how we knew

The starting complaint was: console errors and high memory usage. Rather
than guess, we opened the deployed app and measured it:

- **24 concurrent Web Animations running at idle**, on a completely empty
  dashboard (`document.getAnimations()` in devtools). Nothing was happening
  on screen that needed animating, and it was still running.
- **16 elements using `backdrop-filter: blur`** simultaneously — the
  glassmorphism cards, layered on top of the moving background.
- Both of these were confirmed in `style.css`: six `animation: … infinite`
  loops (clouds ×3, water shine ×2, the character's "breathe", birds,
  falling leaves, fireflies) that start on page load and never stop,
  regardless of whether the tab is visible or the user has motion
  sensitivity settings on.

That's the root cause. It isn't really a "bug" in the sense of broken
logic — the animations do exactly what they were coded to do. The problem
is that they were coded to run *unconditionally, forever*.

## 2. Why infinite animations + `backdrop-filter: blur` are expensive

Two mechanisms compound here:

- **`animation: … infinite`** keeps the browser's compositor thread awake
  permanently. Every frame, it has to recompute the animated element's
  position/transform and repaint — even if the tab is in the background and
  literally nobody can see it. Six of these running at once is six ongoing
  repaint obligations, forever.
- **`backdrop-filter: blur`** is one of the most expensive things a browser
  can render. To blur a panel, it has to resample everything *behind* that
  panel, every frame it repaints. Stack a blurred panel on top of a
  constantly-moving background scene, and you've turned "occasionally
  repaint a static card" into "recompute an expensive blur, continuously,
  forever."

Neither of these shows up as a JavaScript error — that's why the console
alone didn't point straight at it. This is a rendering-cost problem, and
you find it by measuring what's running (`getAnimations()`, the Performance
tab), not by reading stack traces.

## 3. The fix, and the tradeoffs we chose

We did **not** delete the animations or gut the app's nature theme — that's
a legitimate creative identity for the project, and killing it wasn't asked
for or necessary to fix the perf problem. Instead we *gated* it, using two
independent conditions:

| Element | Motion, tab visible, no reduced-motion pref | `prefers-reduced-motion: reduce` | Tab hidden |
|---|---|---|---|
| Clouds, water, character, birds, leaves, fireflies | run (at whatever speed the `--anim` slider is set to) | **off** — frozen | **paused** |
| Critical-task pulse | runs | **off** — replaced by a static ring so "this is urgent" still reads without motion | **paused** |
| Button ripples | run | still run (short, one-shot, user-triggered — not the problem) | n/a |

Nothing was deleted. `animation.js` in particular was *kept and extended*,
not removed — it turned out to only handle the ripple micro-interaction,
not the scene itself (see the correction in §6), so deleting it would have
broken ripples without touching the real bug at all. That's a good example
of why you verify an assumption against the actual code before acting on
it, even when the assumption sounds reasonable.

Two implementation details worth understanding, not just copying:

- **`prefers-reduced-motion` is a pure CSS media query.** There's no way to
  ask "is the tab visible" from CSS, so that half had to be JavaScript
  (`document.visibilitychange` in `animation.js`, toggling an
  `anim-paused` class on `<body>`).
- **We didn't reuse the existing `--anim` speed variable to pause things**
  (e.g. setting it to `0`). The CSS is `animation-duration: calc(120s /
  var(--anim))` — dividing by zero produces an invalid CSS duration, which
  browsers just ignore, leaving the *previous* duration in place. Instead,
  pausing uses `animation-play-state: paused`, which is the actual
  CSS-native way to freeze an animation without touching its speed. The
  `--anim` slider still does exactly what it did before; pausing is a
  separate, independent layer on top of it.

**Deferred, not done:** the 16 stacked `backdrop-filter` layers are still
there. Reducing how many panels blur simultaneously (or how strong the
blur is) is a real, visible design decision — it changes how the app
looks — so we're flagging it as the next lever to pull rather than
changing it silently as a "performance fix."

## 4. Why untested data-migration code is risky

`backup.js` has a genuinely well-designed backup/export/import system: it
handles both an old (v1) and new (v2) file format, merges imported data
with what's already there instead of blindly overwriting, and takes a
safety backup before a destructive replace. That's good instinct.

But it had **zero test coverage**, and it's exactly the kind of code where
a bug is worst: if `validateBackup` or `mergePlannerData` has a subtle
defect, the failure mode isn't a crash — it's silently losing or
duplicating someone's real tasks on import, possibly without them noticing
until much later. Untested code that *renders* wrong is annoying. Untested
code that *migrates data* wrong is a trust problem. That's why it got
tests before the render-performance work, even though the render issue is
also real.

The merge logic dedupes on:
- **id**, when the record has one, or
- a **content key** — `title::block::section::deadline` for tasks,
  `title::category` for flashcards — when it doesn't.

Writing the characterization tests surfaced a documented sharp edge (not
changed, since it's existing behavior and out of scope for this cleanup):
two genuinely different tasks that happen to share title + block + section
with no deadline will collide on that content key, and an import will
silently treat the second one as a duplicate and skip it. A more robust
content key (e.g. hashing the full record) would close this gap — flagged
here rather than fixed, since it's a behavior change that deserves its own
conscious decision.

## 5. A real bug the tests caught

`matchesSearch(task, query)` lowercased the *haystack* (title, description,
etc.) but not the *query* itself. It "worked" in the running app purely
because the one caller (`renderAll`'s search binding) happened to
lowercase the query before passing it in. The moment a characterization
test called `matchesSearch(task, 'WRITE')` directly, it failed.

This is a small bug, but a real one: the function's correctness silently
depended on every future caller remembering to pre-lowercase, with nothing
enforcing that. Per this project's TDD rule — a failing test after writing
production code means you diagnose whether the test or the code is wrong,
you don't just edit the test to match — the diagnosis here was "the code's
contract is wrong," so `matchesSearch` now lowercases the query itself.
This is the concrete value of writing tests against a function's intended
contract instead of only ever exercising it through the one code path that
happens to call it correctly today.

## 6. Why debouncing search matters

Before: every keystroke in the search box called `renderAll()` *and*
`renderFlashcards()`, each of which wipes the relevant DOM lists with
`innerHTML = ''` and rebuilds them from scratch, then calls
`window.lucide.createIcons()` — a full-DOM icon rescan. Typing a five-letter
word did that ten times.

The fix wraps the search handler in a small `debounce()` (150ms): a burst
of keystrokes now triggers one render, after you pause typing, instead of
one render per keystroke. `renderAll()` also used to run a `querySelector`
per task to find that task's target list — replaced with a single `Map`
built once per render, so the cost no longer grows with both the number of
tasks *and* a DOM query each.

## 7. How TDD was applied here

Each phase followed Red → Green → Refactor:

1. **Red** — write a test that fails, for a reason that matches the actual
   defect (not a placeholder). For the animation work, that meant reading
   `style.css` and `animation.js` as text and asserting the gating exists.
   For `backup.js` and `script.js`, it meant writing *characterization*
   tests — pinning down what the existing merge/validate/search logic
   already does, before touching it, so a regression shows up immediately.
2. **Green** — the minimum production change that makes the test(s) pass.
   No drive-by refactoring here, even when you can see other things you'd
   like to clean up.
3. **Refactor** — clean up now that the behavior is locked in by tests
   (e.g. documenting the merge dedupe keys, removing a helper function that
   had gone dead once the render fix landed), then re-run the full suite
   to confirm nothing moved.

One recurring trick made this possible without a build step: both
`backup.js` and `script.js` are browser-global scripts (no `import`/
`export`), loaded via `<script>` tags in `index.html`. To make their pure
functions testable in Node, each file got:
```js
if (typeof document !== 'undefined') {
  // ...existing DOMContentLoaded bootstrap, unchanged...
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { /* the functions worth testing directly */ };
}
```
In the browser, `document` exists and `module` doesn't, so behavior is
byte-for-byte what it was before. In Node (`require('../script.js')`),
`document` doesn't exist so the bootstrap is skipped, and `module.exports`
makes the functions `require`-able. No bundler, no transpiler, no new
dependency — just two guard clauses.

## 8. How to run the tests

```bash
npm test
```

This runs `node --test` (Node's built-in test runner, available since
Node 18, zero external dependencies — matching this project's existing
zero-dependency approach) against everything in `test/`.

## 9. Security audit

Alongside the perf/TDD work, this branch also got a quick security pass —
worth doing on any repo before you consider it "done," not just this one.

**Credentials sweep: clean.** Checked the working tree *and* the full git
history (`git log --all -p`, plus a filename search across every commit)
for API keys, tokens, passwords, private keys, `.env` files, and similarly
shaped secrets. Nothing found. If you ever *do* accidentally commit a
secret, note that deleting it in a later commit isn't enough — it's still
sitting in the git history forever unless you rewrite it out, which is why
it's worth checking history, not just the current files.

**XSS:** checked every `innerHTML` call site against what's being
interpolated into it. The app is consistent about running user-controlled
strings (task titles, tags, block/category names) through `escapeHtml()`
before they touch `innerHTML` — genuinely careful, and worth keeping up as
the pattern to follow for anything new.

**Two real findings, both fixed on this branch:**

- **Unpinned CDN script, no integrity check.** `index.html` loaded
  `lucide@latest` from unpkg — a floating version with no verification.
  A future release of that package (or a compromise of unpkg / the
  package itself) would have executed with full page privileges,
  automatically, with nobody reviewing it first. Fixed by pinning to the
  exact version in use (`1.27.0`) and adding a Subresource Integrity hash
  (`integrity="sha384-..."` + `crossorigin="anonymous"`) — the browser now
  refuses to run the script if the bytes it receives don't match that
  hash. This is the standard fix any time you load a third-party script
  from a CDN rather than bundling it yourself: pin the version, add SRI.
- **Unrestricted `localStorage` key write on import.** `replacePlannerData()`
  wrote *every* key found in an imported backup file's `localStorage`
  snapshot, with nothing checking that the key actually belonged to this
  app. `localStorage` is scoped by **origin**, not by path — so
  `nikhilcodexx.github.io/work-planner` and any other project you host
  under `nikhilcodexx.github.io/*` share the same storage. A crafted or
  corrupted "backup" file could have silently overwritten data belonging
  to a *different* project on the same domain. Fixed by restricting the
  import loop to keys starting with `nf_` (this app's own namespace) —
  covered by a test in `test/backup.test.js` that imports a file
  containing an `evil_other_app_key` and asserts it's never written. The
  general lesson: any time you deserialize an untrusted file and use its
  keys to write into shared state (storage, an object, a database column),
  validate the keys against an allowlist — don't trust the file to only
  contain keys you expect.

## 10. Deferred / future work

Noted here on purpose rather than done silently, so it's a conscious
backlog rather than scope creep:

- **Reduce stacked `backdrop-filter` usage.** Still the largest remaining
  rendering cost; fixing it is a visible design change and deserves its
  own pass.
- **Lazy-mount views.** All four top-level views (Dashboard, Flashcards,
  Settings, empty-state) are in the DOM simultaneously and toggled via a
  CSS class, rather than rendered on demand. Low payoff at this data scale
  today, but worth revisiting if the app grows.
- **A linter.** Nothing wrong was found that a linter would have caught
  here, but it's cheap insurance as the codebase grows past ~3000 lines by
  hand.
- **A Content-Security-Policy meta tag.** Not fixing anything currently
  broken — there's no user-generated page content and no iframes — but
  cheap defense-in-depth given the app already loads one external script,
  and a CSP would make a future accidental `eval`/inline-script mistake
  fail loudly instead of silently working.
