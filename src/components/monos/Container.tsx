import * as React from 'react';
import { cn } from '@/lib/utils';

export type ContainerProps = {
  size?: 'sm' | 'md' | 'lg' | 'full';
  /** Боковые поля колонки. */
  padded?: boolean;
  className?: string;
  children?: React.ReactNode;
};

const SIZES: Record<NonNullable<ContainerProps['size']>, string> = {
  sm: 'max-w-2xl',
  md: 'max-w-4xl',
  lg: 'max-w-5xl',
  full: 'max-w-none',
};

/**
 * Колонка страницы по центру: предельная мера и поля набора. Это примитив
 * раскладки, а не оболочка приложения.
 */
export function Container({ size = 'lg', padded = true, className, children }: ContainerProps) {
  return (
    <div className={cn('mx-auto w-full', padded ? 'px-4 sm:px-6' : '', SIZES[size], className)}>
      {children}
    </div>
  );
}
