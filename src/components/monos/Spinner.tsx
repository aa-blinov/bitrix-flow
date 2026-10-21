import { cn } from '@/lib/utils';

export type SpinnerSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/**
 * Тихая крутилка. Берёт цвет текста, поэтому одинаково живёт в кнопке и на
 * поверхности. Если задан `label`, она читается вслух, иначе — скрыта.
 */
export function Spinner({
  size = 'md',
  label = '',
  className,
}: {
  size?: SpinnerSize;
  label?: string;
  className?: string;
}) {
  const sizes: Record<SpinnerSize, string> = {
    xs: 'h-3 w-3',
    sm: 'h-3.5 w-3.5',
    md: 'h-4 w-4',
    lg: 'h-5 w-5',
    xl: 'h-6 w-6',
  };

  return (
    <span
      className={cn('inline-flex items-center justify-center', sizes[size], className)}
      role={label ? 'status' : undefined}
      aria-label={label || undefined}
      aria-hidden={label ? undefined : 'true'}
    >
      <svg className="animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeOpacity="0.25"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}
