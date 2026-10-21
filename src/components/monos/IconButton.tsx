'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Tooltip } from './Tooltip';

export type IconButtonVariant = 'outline' | 'ghost';
export type IconButtonSize = 'sm' | 'md' | 'lg';

const SIZES: Record<IconButtonSize, string> = {
  sm: 'h-7 w-7',
  md: 'h-9 w-9',
  lg: 'h-11 w-11',
};

const VARIANTS: Record<IconButtonVariant, string> = {
  outline: 'border border-line text-ink-soft hover:border-line-strong hover:text-ink',
  ghost: 'text-ink-soft hover:bg-surface hover:text-ink',
};

const BASE =
  'inline-flex items-center justify-center rounded-ui transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-30 max-sm:h-11 max-sm:w-11';

/**
 * Кнопка без подписи. Имя всегда живёт в `label`, подсказка его повторяет, но
 * никогда не заменяет: доступное имя обязано быть у самой кнопки.
 */
export type IconButtonProps = React.ComponentProps<'button'> & {
  /** Доступное имя. Обязательное. */
  label: string;
  /** Текст подсказки; пустая строка убирает подсказку совсем. */
  tooltipText?: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Состояние нажатой кнопки-переключателя. */
  pressed?: boolean;
};

export function IconButton({
  className,
  label,
  tooltipText,
  variant = 'outline',
  size = 'md',
  type = 'button',
  disabled = false,
  pressed,
  children,
  ...props
}: IconButtonProps) {
  const tip = tooltipText === undefined ? label : tooltipText;

  return (
    <Tooltip text={tip}>
      <button
        type={type}
        disabled={disabled}
        aria-label={label}
        aria-pressed={pressed === undefined ? undefined : pressed}
        className={cn(
          BASE,
          SIZES[size],
          VARIANTS[variant],
          pressed ? 'bg-surface text-ink' : '',
          className,
        )}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
}
