import { cn } from '@/lib/utils';
import type { Presence } from '@/lib/messenger';
import { t } from '@/lib/i18n';

const COLOR = { online: 'bg-success', busy: 'bg-danger', away: 'bg-warning' } as const;
const LABEL = {
  get online() {
    return t('В сети');
  },
  get busy() {
    return t('Не беспокоить');
  },
  get away() {
    return t('Отошёл');
  },
} as const;

// Точка присутствия: у не в сети ничего не рисуем, серая точка только шумела бы в списке.
export function PresenceDot({ presence, className }: { presence?: Presence; className?: string }) {
  if (!presence || presence.state === 'offline') return null;
  return (
    <span
      role="img"
      aria-label={LABEL[presence.state]}
      className={cn('inline-block size-2.5 rounded-full', COLOR[presence.state], className)}
    />
  );
}
