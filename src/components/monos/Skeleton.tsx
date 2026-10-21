import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Заглушка загрузки. Занимает место, которое потом займёт содержимое, чтобы
 * страница не прыгала; единственное движение — пульс, и он останавливается
 * при «меньше движения».
 */
export function Skeleton({
  width = '100%',
  height = '1rem',
  rounded = 'ui',
  className,
  ...props
}: React.ComponentProps<'span'> & {
  width?: string;
  height?: string;
  rounded?: 'ui' | 'full';
}) {
  return (
    <span
      className={cn(
        'block animate-pulse bg-surface-2 motion-reduce:animate-none',
        rounded === 'full' ? 'rounded-full' : 'rounded-ui',
        className,
      )}
      style={{ width, height }}
      aria-hidden="true"
      {...props}
    />
  );
}
