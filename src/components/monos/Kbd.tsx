import * as React from 'react';
import { cn } from '@/lib/utils';

/** Клавиша: используется, когда сочетание написано словами. */
export function Kbd({ className, children, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'inline-flex min-h-6 items-center rounded-ui border border-line bg-surface px-1.5 font-ui text-whisper text-ink-soft',
        className,
      )}
      {...props}
    >
      {children}
    </kbd>
  );
}
