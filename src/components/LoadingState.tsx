import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function LoadingState({
  label = 'Загрузка…',
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
        <Loader2 className="mx-auto mb-3 size-8 animate-spin text-ink-soft" strokeWidth={1.7} />
        <p className="text-xs uppercase tracking-widest text-ink-faint">{label}</p>
      </div>
    </div>
  );
}
