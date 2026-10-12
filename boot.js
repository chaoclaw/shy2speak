(() => {
  const root = document.documentElement;
  try {
    const storedMode = localStorage.getItem('shy-mode');
    const mode = ['light', 'dark', 'system'].includes(storedMode) ? storedMode : 'light';
    const resolvedMode = mode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : mode === 'system' ? 'light' : mode;
    const storedTheme = localStorage.getItem('shy-theme');
    const theme = ['violet', 'ocean', 'forest', 'sunset', 'sakura'].includes(storedTheme) ? storedTheme : 'violet';
    const language = localStorage.getItem('shy-language') === 'en' ? 'en' : 'zh';
    root.dataset.mode = resolvedMode;
    root.dataset.theme = theme;
    root.dataset.sidebarCollapsed = localStorage.getItem('shy-sidebar-collapsed') === 'true' ? 'true' : 'false';
    root.lang = language === 'en' ? 'en' : 'zh-CN';
    root.style.colorScheme = resolvedMode;
  } catch {
    // The static defaults remain usable when browser storage is unavailable.
  }
})();
