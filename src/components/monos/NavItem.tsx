'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Строка навигации. Ссылка, если задан `href`, и кнопка в остальных случаях;
 * активная строка помечена `aria-current="page"`.
 */
export type NavItemProps = {
  href?: string;
  active?: boolean;
  disabled?: boolean;
  label?: string;
  icon?: React.ReactNode;
  trailing?: React.ReactNode;
  onClick?: React.MouseEventHandler<HTMLElement>;
  className?: string;
  title?: string;
  id?: string;
  'aria-label'?: string;
  'data-testid'?: string;
  children?: React.ReactNode;
};

export function NavItem({
  className,
  href,
  active = false,
  disabled = false,
  label = '',
  icon,
  trailing,
  children,
  onClick,
  ...props
}: NavItemProps) {
  const classes = cn(
    'group flex min-h-9 w-full items-center gap-2.5 rounded-ui px-2.5 text-left text-sm transition-colors duration-fast max-sm:min-h-11',
    active ? 'bg-surface font-bold text-ink' : 'text-ink-soft hover:bg-surface hover:text-ink',
    disabled && 'cursor-not-allowed opacity-50',
    className,
  );

  const content = (
    <>
      {icon}
      <span className="min-w-0 flex-1 truncate">{children ?? label}</span>
      {trailing}
    </>
  );

  if (href) {
    return (
      <a
        href={disabled ? undefined : href}
        aria-disabled={disabled ? 'true' : undefined}
        tabIndex={disabled ? -1 : undefined}
        aria-current={active ? 'page' : undefined}
        role="link"
        className={classes}
        onClick={onClick}
        {...props}
      >
        {content}
      </a>
    );
  }

  return (
    <button
      type="button"
      disabled={disabled}
      aria-current={active ? 'page' : undefined}
      role="button"
      className={classes}
      onClick={onClick}
      {...props}
    >
      {content}
    </button>
  );
}
