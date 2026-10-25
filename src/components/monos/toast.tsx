'use client';

// Всплывающие сообщения: подтверждение действия, ошибка и «Отменить».
// Вид — из набора @monos/ui: точка-сигнал, слово и тихая поверхность.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';

type ToastTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export type ToastOptions = {
  title: string;
  description?: string;
  tone?: ToastTone;
  /** Кнопка справа: обычно «Отменить». */
  action?: { label: string; onClick: () => void | Promise<void> };
  /** Сколько держать на экране; 0 — до закрытия вручную. */
  durationMs?: number;
};

type ToastItem = ToastOptions & { id: number };

const ToastContext = createContext<(options: ToastOptions) => void>(() => {});

/** Показать сообщение. Вне провайдера просто ничего не делает. */
export function useToast() {
  return useContext(ToastContext);
}

const TONE_DOT: Record<ToastTone, string> = {
  neutral: 'bg-ink-muted',
  info: 'bg-info',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const show = useCallback((options: ToastOptions) => {
    const id = Date.now() + Math.random();
    // Больше трёх сообщений на экране — это уже шум.
    setItems((current) => [...current.slice(-2), { ...options, id }]);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-0 z-tooltip flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-4 sm:items-end"
        role="region"
        aria-label={t('Сообщения приложения')}
      >
        {items.map((item) => (
          <Toast key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function Toast({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  const duration = item.durationMs ?? (item.action ? 8000 : 4000);

  useEffect(() => {
    if (!duration) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDismiss]);

  return (
    <div
      // assertive только для ошибок: остальное не должно перебивать чтение.
      role={item.tone === 'danger' ? 'alert' : 'status'}
      aria-live={item.tone === 'danger' ? 'assertive' : 'polite'}
      className="animate-slide-up pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-ui border border-line bg-canvas p-3 text-ink shadow-overlay"
    >
      <span
        className={cn('mt-1.5 h-2 w-2 shrink-0 rounded-full', TONE_DOT[item.tone ?? 'neutral'])}
        aria-hidden="true"
      />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold">{item.title}</p>
        {item.description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{item.description}</p>
        ) : null}
      </div>
      {item.action ? (
        <button
          type="button"
          className="mt-1 inline-flex shrink-0 items-center text-xs font-bold uppercase tracking-widest text-ink transition-opacity duration-fast hover:opacity-60 max-sm:min-h-11"
          onClick={() => {
            void item.action?.onClick();
            onDismiss();
          }}
        >
          {item.action.label}
        </button>
      ) : null}
      <button
        type="button"
        aria-label={t('Закрыть уведомление')}
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-ui text-ink-soft transition-colors duration-fast hover:text-ink max-sm:h-11 max-sm:w-11"
        onClick={onDismiss}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="m6 6 12 12M18 6 6 18"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}

/** Готовые сообщения для частых случаев. */
export function useTaskToasts() {
  const toast = useToast();
  return useMemo(
    () => ({
      saved: (what: string) => toast({ title: what, tone: 'success' }),
      failed: (what: string, error?: unknown) =>
        toast({
          title: what,
          description:
            error instanceof Error ? error.message.slice(0, 160) : t('Изменение не сохранилось'),
          tone: 'danger',
        }),
      undoable: (title: string, undo: () => void | Promise<void>) =>
        toast({ title, tone: 'success', action: { label: t('Отменить'), onClick: undo } }),
    }),
    [toast],
  );
}
