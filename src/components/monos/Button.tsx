import * as React from 'react';
import { cn } from '@/lib/utils';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'text' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Кнопка-слово. В наборе нет ни залитой, ни обведённой кнопки: слово и есть
 * кнопка, а рамка принадлежит только выбору из вариантов.
 */
const SIZES: Record<ButtonSize, string> = {
  sm: 'min-h-7 px-3 text-xs',
  md: 'min-h-9 px-4 text-sm',
  lg: 'min-h-11 px-5 text-sm',
};

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'font-bold text-ink hover:opacity-70 active:opacity-60',
  secondary: 'font-normal text-ink-soft hover:text-ink',
  text: 'font-bold text-ink hover:opacity-60 active:opacity-50',
  quiet: 'font-medium normal-case tracking-normal text-ink-soft hover:text-ink',
  danger: 'font-bold text-danger-text hover:opacity-70 active:opacity-60',
};

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-ui uppercase tracking-widest transition-colors duration-fast max-sm:min-h-11';

export type ButtonProps = React.ComponentProps<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Показывает крутилку вместо иконки и блокирует нажатие. */
  loading?: boolean;
  /** Растягивает кнопку на всю ширину контейнера. */
  full?: boolean;
  /** Иконка перед подписью. */
  icon?: React.ReactNode;
  /** Иконка после подписи. */
  trailing?: React.ReactNode;
};

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  type = 'button',
  disabled = false,
  loading = false,
  full = false,
  icon,
  trailing,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading ? 'true' : undefined}
      className={cn(
        BASE,
        SIZES[size],
        VARIANTS[variant],
        loading ? 'cursor-wait opacity-70' : 'disabled:cursor-not-allowed disabled:opacity-30',
        full && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Spinner size={size === 'sm' ? 'sm' : 'md'} /> : icon}
      <span className="truncate">{children}</span>
      {trailing}
    </button>
  );
}
