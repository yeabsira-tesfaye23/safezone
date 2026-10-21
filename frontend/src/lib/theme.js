import { useEffect, useState } from 'react';

// Light/dark theme. The choice is remembered in this browser; without a choice the device setting is used.
const KEY = 'sz-theme';

export function currentTheme() {
  const set = document.documentElement.getAttribute('data-theme');
  if (set === 'light' || set === 'dark') return set;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'dark' ? '#0c2b29' : '#0f5c58');
  try { localStorage.setItem(KEY, theme); } catch { /* storage blocked: the choice lasts for this visit only */ }
}

export function useTheme() {
  const [theme, setTheme] = useState(currentTheme);
  useEffect(() => { applyTheme(theme); }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}
