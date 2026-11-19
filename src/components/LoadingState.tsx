import { cn } from '@/lib/utils';
import { t } from '@/lib/i18n';
import { Spinner } from './monos/Spinner';

export default function LoadingState({
  label = t('Загрузка…'),
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      role="status"
      className={cn('flex min-h-[60vh] items-center justify-center bg-canvas', className)}
    >
      <div className="text-center">
        {/* Наборный спиннер, а не сторонний Loader2: одна форма и толщина
            со всеми остальными состояниями загрузки. Размер 32px как раньше. */}
        <Spinner
          size="xl"
          className="mx-auto mb-3 h-8 w-8 text-ink-soft [&>svg]:h-full [&>svg]:w-full"
        />
        <p className="text-xs uppercase tracking-widest text-ink-faint">{label}</p>
      </div>
    </div>
  );
}
