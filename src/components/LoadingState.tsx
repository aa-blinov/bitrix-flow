import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Spinner } from './monos/Spinner';

/**
 * Единый лоадер. Крутилка появляется с задержкой: быстрая загрузка проходит без вспышки, а
 * не мигает кругом на долю секунды. На странице она стоит на одном расстоянии от верха
 * области, а не по центру: по центру разных по высоте областей она прыгала между экранами
 * и при появлении шапки. `compact` для узких мест: карточка, колонка чата, сайдбар.
 */
export default function LoadingState({
  label = t('Загрузка…'),
  compact = false,
  className,
}: {
  label?: string;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex justify-center',
        compact ? 'min-h-24 items-center' : 'min-h-72 items-start pt-20',
        className,
      )}
    >
      <div className="animate-loader-in text-center">
        <Spinner
          size="xl"
          className="mx-auto mb-3 h-8 w-8 text-ink-soft [&>svg]:h-full [&>svg]:w-full"
        />
        <p className="text-xs uppercase tracking-widest text-ink-faint">{label}</p>
      </div>
    </div>
  );
}
