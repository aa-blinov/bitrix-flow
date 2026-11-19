import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { FONT, PAD } from '@/components/monos/scale';

type PageHeaderProps = {
  title: string;
  description: string;
  actions?: ReactNode;
  className?: string;
};

export default function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        'sticky top-0 z-menu border-b border-line bg-canvas/95 backdrop-blur',
        PAD.page,
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className={FONT.pageTitle}>{title}</h1>
          <p className={cn('mt-1', FONT.body)}>{description}</p>
        </div>
        {actions && <div className="shrink-0">{actions}</div>}
      </div>
    </header>
  );
}

export { PageHeader };
