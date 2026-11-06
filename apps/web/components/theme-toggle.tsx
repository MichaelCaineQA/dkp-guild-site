'use client';

import { useEffect, useState } from 'react';

/**
 * Переключатель светлой/тёмной темы в шапке (issue ревью владельца, п.2).
 * Ручной выбор главнее системного: сохраняется в localStorage и ставит
 * класс .dark / .light на <html>; без выбора работает prefers-color-scheme.
 */
export function ThemeToggle() {
  const [manual, setManual] = useState<'dark' | 'light' | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem('theme');
    if (saved === 'dark' || saved === 'light') {
      setManual(saved);
      apply(saved);
    }
  }, []);

  const toggle = () => {
    const current = manual ?? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    setManual(next);
    window.localStorage.setItem('theme', next);
    apply(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded-lg border border-line bg-surface px-2.5 py-1 text-sm hover:bg-surface-muted"
      title={manual === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
      aria-label="Переключить тему"
    >
      {manual === 'dark' ? '☀' : manual === 'light' ? '🌙' : '☾'}
    </button>
  );
}

function apply(theme: 'dark' | 'light') {
  const root = document.documentElement;
  root.classList.toggle('dark', theme === 'dark');
  root.classList.toggle('light', theme === 'light');
}
