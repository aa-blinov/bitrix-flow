import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Волосок. По умолчанию декоративный; при `decorative={false}` разрыв несёт
 * смысл и разделитель попадает в дерево доступности.
 */
export type SeparatorProps = React.ComponentProps<'div'> & {
  orientation?: 'horizontal' | 'vertical';
  decorative?: boolean;
};

export function Separator({
  className,
  orientation = 'horizontal',
  decorative = true,
  ...props
}: SeparatorProps) {
  const vertical = orientation === 'vertical';

  return (
    <div
      role={decorative ? undefined : 'separator'}
      aria-orientation={!decorative ? orientation : undefined}
      aria-hidden={decorative ? 'true' : undefined}
      className={cn(
        'shrink-0 bg-line',
        vertical ? 'min-h-4 w-px self-stretch' : 'h-px w-full',
        className,
      )}
      {...props}
    />
  );
}
