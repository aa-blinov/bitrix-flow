'use client';

import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';
import type { FieldSize, FieldVariant } from './TextField';

export type SelectOption = {
  value: string;
  label?: string;
  disabled?: boolean;
};

/** То, что получает onChange: как у нативного select, чтобы вызовы не менялись. */
export type SelectChangeEvent = {
  target: { value: string };
  currentTarget: { value: string };
};

/**
 * Выбор из списка в духе Select из @monos/ui: список рисует набор, а не система, поэтому
 * открытая выпадашка выглядит как остальной интерфейс в обеих темах. Это listbox: кнопка
 * открывает его, стрелки и Home/End ходят, Enter выбирает, Escape закрывает, буква
 * прыгает к пункту на эту букву. Список уходит в портал с фиксированной позицией: в
 * таблицах и модалках с прокруткой обычное абсолютное позиционирование его обрезало бы.
 */
export type SelectFieldProps = {
  label?: string;
  hint?: string;
  error?: string;
  options?: SelectOption[];
  placeholder?: string;
  size?: FieldSize;
  variant?: FieldVariant;
  className?: string;
  id?: string;
  value?: string;
  disabled?: boolean;
  required?: boolean;
  title?: string;
  onChange?: (event: SelectChangeEvent) => void;
  'aria-label'?: string;
};

const SIZES: Record<FieldSize, string> = {
  sm: 'h-7 text-xs',
  md: 'h-9 text-sm',
  lg: 'h-11 text-sm',
};

type Position = {
  left: number;
  top?: number;
  bottom?: number;
  minWidth: number;
  maxHeight: number;
};

// Сколько места оставляем у края окна и между полем и списком.
const EDGE = 8;
const GAP = 4;
const MAX_HEIGHT = 288;

export function SelectField({
  label,
  hint,
  error,
  options = [],
  placeholder,
  size = 'md',
  variant = 'underline',
  className,
  id,
  value = '',
  disabled = false,
  required,
  title,
  onChange,
  'aria-label': ariaLabel,
}: SelectFieldProps) {
  const fallbackId = `ui-select-${React.useId()}`;
  const fieldId = id || fallbackId;
  const listId = `${fieldId}-list`;
  const labelId = `${fieldId}-label`;
  const describedBy =
    [hint ? `${fieldId}-hint` : '', error ? `${fieldId}-error` : ''].filter(Boolean).join(' ') ||
    undefined;

  const [open, setOpen] = React.useState(false);
  const [position, setPosition] = React.useState<Position | null>(null);
  const triggerEl = React.useRef<HTMLButtonElement | null>(null);
  const listEl = React.useRef<HTMLDivElement | null>(null);

  // Пустой вариант с подсказкой выбирается так же, как у нативного select без required.
  const all = React.useMemo(
    () =>
      placeholder ? [{ value: '', label: placeholder, disabled: required }, ...options] : options,
    [placeholder, required, options],
  );
  const selected = all.find((option) => option.value === value);
  const display = selected ? (selected.label ?? selected.value) : (placeholder ?? '');
  const empty = !selected || (placeholder !== undefined && value === '');

  const place = React.useCallback(() => {
    const rect = triggerEl.current?.getBoundingClientRect();
    if (!rect) return;
    const below = window.innerHeight - rect.bottom - GAP - EDGE;
    const above = rect.top - GAP - EDGE;
    const wanted = Math.min(MAX_HEIGHT, listEl.current?.scrollHeight ?? MAX_HEIGHT);
    const up = below < wanted && above > below;
    setPosition({
      left: Math.max(EDGE, Math.min(rect.left, window.innerWidth - rect.width - EDGE)),
      minWidth: rect.width,
      ...(up
        ? { bottom: window.innerHeight - rect.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) }
        : { top: rect.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) }),
    });
  }, []);

  const enabledOptions = () =>
    Array.from(
      listEl.current?.querySelectorAll<HTMLElement>('[role="option"]:not([disabled])') ?? [],
    );

  const focusOption = (index: number) => {
    const items = enabledOptions();
    if (!items.length) return;
    items[(index + items.length) % items.length]?.focus();
  };

  const openList = (focus: 'selected' | 'first' | 'last' = 'selected') => {
    if (disabled) return;
    setOpen(true);
    // Фокус после того, как список отрисован и встал на место.
    requestAnimationFrame(() => {
      place();
      if (focus === 'first') return focusOption(0);
      if (focus === 'last') return focusOption(-1);
      const current =
        listEl.current?.querySelector<HTMLElement>('[role="option"][aria-selected="true"]') ??
        enabledOptions()[0];
      current?.focus();
    });
  };

  const close = React.useCallback((returnFocus = true) => {
    setOpen(false);
    if (returnFocus) triggerEl.current?.focus();
  }, []);

  const choose = (option: SelectOption) => {
    if (option.disabled) return;
    if (option.value !== value)
      onChange?.({ target: { value: option.value }, currentTarget: { value: option.value } });
    close();
  };

  // Пока список открыт, он следует за полем при прокрутке и смене размера окна; клик
  // мимо поля и списка закрывает его.
  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!triggerEl.current?.contains(target) && !listEl.current?.contains(target)) close(false);
    };
    window.addEventListener('scroll', place, true);
    window.addEventListener('resize', place);
    window.addEventListener('pointerdown', onPointer);
    return () => {
      window.removeEventListener('scroll', place, true);
      window.removeEventListener('resize', place);
      window.removeEventListener('pointerdown', onPointer);
    };
  }, [open, place, close]);

  // Буква прыгает к следующему пункту, который на неё начинается.
  const jumpTo = (key: string) => {
    const items = enabledOptions();
    const start = items.indexOf(document.activeElement as HTMLElement);
    for (let step = 1; step <= items.length; step++) {
      const item = items[(start + step) % items.length];
      if (item.textContent?.trim().toLocaleLowerCase().startsWith(key.toLocaleLowerCase())) {
        item.focus();
        return;
      }
    }
  };

  const onTriggerKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) openList(event.key === 'ArrowUp' ? 'last' : 'selected');
    } else if (event.key === 'Escape' && open) {
      // Escape закрывает список, а не модалку, в которой он стоит.
      event.preventDefault();
      event.stopPropagation();
      close();
    }
  };

  const onListKeyDown = (event: React.KeyboardEvent) => {
    const items = enabledOptions();
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusOption(index + 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusOption(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusOption(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusOption(-1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      close(false);
    } else if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
      jumpTo(event.key);
    }
  };

  const shape =
    variant === 'boxed'
      ? `rounded-ui border bg-surface pl-3 pr-2 ${
          error
            ? 'border-danger focus:border-danger'
            : 'border-line hover:border-line-strong focus:border-ink-soft'
        }`
      : `border-b bg-transparent pl-1 pr-1 ${
          error ? 'border-danger focus:border-danger' : 'border-line focus:border-ink-soft'
        }`;

  return (
    <div className={className}>
      {label ? (
        <span id={labelId} className="mb-1.5 block text-xs uppercase tracking-widest text-ink-soft">
          {label}
        </span>
      ) : null}
      <button
        ref={triggerEl}
        id={fieldId}
        type="button"
        // Кнопка, открывающая список, по WAI-ARIA это select-only combobox.
        role="combobox"
        data-value={value}
        title={title}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        aria-labelledby={!ariaLabel && label ? labelId : undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={describedBy}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onTriggerKeyDown}
        className={cn(
          'flex w-full items-center justify-between gap-2 text-left text-ink outline-none transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50',
          SIZES[size],
          'max-sm:h-11',
          shape,
        )}
      >
        <span className={cn('truncate', empty && 'text-ink-faint')}>{display}</span>
        <svg
          className={cn(
            'h-3.5 w-3.5 shrink-0 text-ink-muted transition-transform duration-fast',
            open && 'rotate-180',
          )}
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M3 4.5 6 7.5 9 4.5"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {error ? (
        <p id={`${fieldId}-error`} className="mt-1.5 text-xs text-danger-text">
          {error}
        </p>
      ) : hint ? (
        <p id={`${fieldId}-hint`} className="mt-1.5 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
      {open &&
        createPortal(
          <div
            ref={listEl}
            id={listId}
            role="listbox"
            // Слой над модалкой (z-modal ниже z-tooltip), а Popover и Menu по этой метке
            // считают клик по списку кликом внутри себя и не закрываются раньше выбора.
            data-ui-portal=""
            aria-label={ariaLabel || label || placeholder}
            tabIndex={-1}
            onKeyDown={onListKeyDown}
            style={{
              left: position?.left,
              top: position?.top,
              bottom: position?.bottom,
              minWidth: position?.minWidth,
              maxHeight: position?.maxHeight ?? MAX_HEIGHT,
              visibility: position ? 'visible' : 'hidden',
            }}
            className="fixed z-tooltip w-max max-w-[min(24rem,calc(100vw-1rem))] overflow-y-auto rounded-ui border border-line bg-canvas p-1 shadow-overlay"
          >
            {all.map((option) => {
              const chosen = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={chosen}
                  data-value={option.value}
                  disabled={option.disabled}
                  onClick={() => choose(option)}
                  className={cn(
                    'flex min-h-8 w-full items-center gap-2 rounded-ui px-2.5 text-left text-sm outline-none transition-colors duration-fast hover:bg-surface hover:text-ink focus:bg-surface focus:text-ink disabled:cursor-not-allowed disabled:opacity-30 max-sm:min-h-11',
                    chosen ? 'text-ink' : 'text-ink-soft',
                  )}
                >
                  <span className="truncate">{option.label ?? option.value}</span>
                  {chosen ? (
                    <svg
                      className="ml-auto h-3.5 w-3.5 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden="true"
                    >
                      <polyline
                        points="20 6 9 17 4 12"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </button>
              );
            })}
          </div>,
          document.body,
        )}
    </div>
  );
}
