'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { t } from '@/lib/i18n';

/**
 * Палитры и режимы из @monos/ui. Набор различает их атрибутами на <html>:
 * `data-theme` — палитра, `data-mode` — светлое или тёмное.
 */
export const THEME_NAMES = [
  'gruvbox',
  'github',
  'dracula',
  'nord',
  'solarized',
  'catppuccin',
] as const;

export const THEME_LABELS: Record<ThemeName, string> = {
  gruvbox: 'Gruvbox',
  github: 'GitHub',
  dracula: 'Dracula',
  nord: 'Nord',
  solarized: 'Solarized',
  catppuccin: 'Catppuccin',
};

export type ThemeName = (typeof THEME_NAMES)[number];
// auto — следить за системной темой: менять data-mode на лету вместе с ОС.
export type ThemeMode = 'light' | 'dark' | 'auto';

const STORAGE_KEY = 'bitrix-flow-theme';
const DEFAULT_THEME: ThemeName = 'gruvbox';

type ThemeContextValue = {
  theme: ThemeName;
  mode: ThemeMode;
  setTheme: (theme: ThemeName) => void;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function isThemeName(value: string): value is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(value);
}

/** Читает сохранённую тему: `палитра:режим`. Старые `dark`/`light` тоже понимаем. */
function readStored(): { theme: ThemeName; mode: ThemeMode } {
  const fallback = {
    theme: DEFAULT_THEME,
    mode: 'auto' as ThemeMode,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      // Без сохранённого режима живём по системе; хранится он как «auto».
      return { theme: DEFAULT_THEME, mode: 'auto' };
    }
    const [rawTheme, rawMode] = saved.split(':');
    const theme = isThemeName(rawTheme) ? rawTheme : DEFAULT_THEME;
    const mode: ThemeMode =
      rawMode === 'auto'
        ? 'auto'
        : rawMode === 'dark' || rawMode === 'light'
          ? rawMode
          : saved === 'dark' || saved === 'light'
            ? saved
            : 'auto';
    return { theme, mode };
  } catch {
    return fallback;
  }
}

function apply(theme: ThemeName, mode: ThemeMode) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  // Авто-режим хранится в хранилище, а на html ставится конкретный режим:
  // CSS знает только light/dark.
  root.setAttribute('data-mode', mode === 'auto' ? systemMode() : mode);
}

function systemMode(): 'light' | 'dark' {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ theme: ThemeName; mode: ThemeMode }>({
    theme: DEFAULT_THEME,
    mode: 'light',
  });

  // На сервере палитра ещё не выбрана: читаем её после монтирования, чтобы
  // разметка не разошлась с тем, что уже поставил инлайновый скрипт.
  useEffect(() => {
    setState(readStored());
  }, []);

  // В авто-режиме ОС меняет тему днём: перекрашиваем вкладку без перезагрузки.
  useEffect(() => {
    if (state.mode !== 'auto') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => apply(state.theme, 'auto');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [state.mode, state.theme]);

  const setTheme = useCallback((theme: ThemeName) => {
    setState((current) => {
      const next = { ...current, theme };
      apply(next.theme, next.mode);
      try {
        window.localStorage.setItem(STORAGE_KEY, `${next.theme}:${next.mode}`);
      } catch {
        // Без localStorage тема живёт только до перезагрузки — не беда.
      }
      return next;
    });
  }, []);

  const setMode = useCallback((mode: ThemeMode) => {
    if (mode === 'auto') {
      setState((current) => {
        apply(current.theme, 'auto');
        try {
          window.localStorage.setItem(STORAGE_KEY, `${current.theme}:auto`);
        } catch {}
        return { ...current, mode: 'auto' };
      });
      return;
    }
    setState((current) => {
      const next: { theme: ThemeName; mode: ThemeMode } = { ...current, mode };
      apply(next.theme, next.mode);
      try {
        window.localStorage.setItem(STORAGE_KEY, `${next.theme}:${next.mode}`);
      } catch {
        // см. выше
      }
      return next;
    });
  }, []);

  const toggleMode = useCallback(() => {
    setState((current) => {
      const next: { theme: ThemeName; mode: ThemeMode } = {
        ...current,
        mode: current.mode === 'dark' ? 'light' : 'dark',
      };
      apply(next.theme, next.mode);
      try {
        window.localStorage.setItem(STORAGE_KEY, `${next.theme}:${next.mode}`);
      } catch {
        // см. выше
      }
      return next;
    });
  }, []);

  const value = useMemo(
    () => ({ theme: state.theme, mode: state.mode, setTheme, setMode, toggleMode }),
    [state.theme, state.mode, setTheme, setMode, toggleMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error(t('useTheme работает только внутри ThemeProvider'));
  }
  return context;
}
