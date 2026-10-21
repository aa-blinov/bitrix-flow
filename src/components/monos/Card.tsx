import * as React from 'react';
import { cn } from '@/lib/utils';

export type CardPadding = 'none' | 'sm' | 'md' | 'lg';

/**
 * Поверхность. `interactive` приподнимает её на полпикселя и превращает в
 * кнопку (Enter и Space тоже работают). Элемент по умолчанию `div`, чтобы
 * карточкой мог быть ссылка, кнопка или секция.
 */
export type CardProps = React.ComponentProps<'div'> & {
  /** `interactive` — карточка ведёт себя как кнопка. */
  interactive?: boolean;
  /** Отмеченный выбор: рамка темнее, заливки нет. */
  selected?: boolean;
  padding?: CardPadding;
};

const PADDINGS: Record<CardPadding, string> = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

export function Card({
  className,
  interactive = false,
  selected = false,
  padding = 'md',
  onClick,
  onKeyDown,
  ...props
}: CardProps) {
  const classes = cn(
    'relative block rounded-ui border bg-surface text-ink shadow-rest',
    selected ? 'border-ink-soft' : 'border-line',
    interactive
      ? 'cursor-pointer transition duration-fast hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift motion-reduce:hover:translate-y-0'
      : '',
    PADDINGS[padding],
    className,
  );

  if (!interactive) {
    return <div className={classes} onClick={onClick} {...props} />;
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={classes}
      onClick={onClick}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (event.defaultPrevented) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
      {...props}
    />
  );
}
