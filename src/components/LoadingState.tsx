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
      className={cn('flex min-h-[60vh] items-center justify-center bg-background', className)}
    >
      <div className="text-center">
        <Loader2 className="mx-auto mb-3 size-10 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
