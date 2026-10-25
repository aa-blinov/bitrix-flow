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
export type ThemeMode = 'light' | 'dark';

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
    mode: 'dark' as ThemeMode,
  };
  if (typeof window === 'undefined') return fallback;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) {
      return {
        theme: DEFAULT_THEME,
        mode: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      };
    }
    const [rawTheme, rawMode] = saved.split(':');
    const theme = isThemeName(rawTheme) ? rawTheme : DEFAULT_THEME;
    const mode: ThemeMode =
      rawMode === 'dark' || rawMode === 'light'
        ? rawMode
        : saved === 'dark' || saved === 'light'
          ? saved
          : 'light';
    return { theme, mode };
  } catch {
    return fallback;
  }
}

function apply(theme: ThemeName, mode: ThemeMode) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-mode', mode);
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
