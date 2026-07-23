/* ===================================================================
   THEME.JS — Theme, accent color, font size, blur, and settings binding
   =================================================================== */
const Theme = {
  /* ===================================== */
  /* APPLY SETTINGS TO THE DOCUMENT        */
  /* ===================================== */
  apply(settings) {
    const root = document.documentElement;
    const body = document.body;
    // Theme mode (light / dark)
    body.classList.toggle('theme-dark', settings.theme === 'dark');
    body.classList.toggle('theme-light', settings.theme !== 'dark');
    // CSS variables
    root.style.setProperty('--accent', settings.accent);
    root.style.setProperty('--forest-2', settings.accent);
    root.style.setProperty('--font-size', settings.fontSize + 'px');
    root.style.setProperty('--card-scale', settings.cardSize);
    root.style.setProperty('--anim', settings.animSpeed);
    root.style.setProperty('--blur', settings.bgBlur + 'px');
    // Theme toggle icon
    const themeIcon = document.querySelector('#themeToggle i');
    if (themeIcon) {
      themeIcon.setAttribute('data-lucide', settings.theme === 'dark' ? 'sun' : 'moon');
      if (window.lucide) window.lucide.createIcons();
    }
  },
  toggle() {
    const s = SettingsStore.get();
    const next = s.theme === 'dark' ? 'light' : 'dark';
    SettingsStore.set({ theme: next });
    this.apply(SettingsStore.get());
  },
};
