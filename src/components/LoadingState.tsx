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
        <div className="mx-auto mb-3 size-10 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-primary" />
        <p className="text-sm text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}
