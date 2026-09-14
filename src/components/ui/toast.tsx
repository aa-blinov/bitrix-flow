'use client';

// Небольшие всплывающие сообщения: подтверждение действия, ошибка и «Отменить».
// Своё, а не библиотека: нужен стек из пары сообщений с кнопкой отмены, ради
// этого тащить зависимость незачем.

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';

type ToastTone = 'info' | 'success' | 'error';

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

const TONE_CLASS: Record<ToastTone, string> = {
  info: 'border-border bg-popover text-popover-foreground',
  success: 'border-emerald-500/40 bg-popover text-popover-foreground',
  error: 'border-destructive/50 bg-popover text-popover-foreground',
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
        className="pointer-events-none fixed inset-x-0 bottom-0 z-100 flex flex-col items-center gap-2 p-4 sm:inset-x-auto sm:right-4 sm:items-end"
        role="region"
        aria-label="Сообщения приложения"
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
      role={item.tone === 'error' ? 'alert' : 'status'}
      aria-live={item.tone === 'error' ? 'assertive' : 'polite'}
      className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border px-3 py-2.5 shadow-lg ${
        TONE_CLASS[item.tone ?? 'info']
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{item.title}</p>
        {item.description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>
        )}
      </div>
      {item.action && (
        <button
          type="button"
          className="shrink-0 rounded-md px-2 py-1 text-sm font-medium text-primary hover:bg-muted"
          onClick={() => {
            void item.action?.onClick();
            onDismiss();
          }}
        >
          {item.action.label}
        </button>
      )}
      <button
        type="button"
        aria-label="Закрыть уведомление"
        className="shrink-0 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
        onClick={onDismiss}
      >
        <X className="size-4" />
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
            error instanceof Error ? error.message.slice(0, 160) : 'Изменение не сохранилось',
          tone: 'error',
        }),
      undoable: (title: string, undo: () => void | Promise<void>) =>
        toast({ title, tone: 'success', action: { label: 'Отменить', onClick: undo } }),
    }),
    [toast],
  );
}
