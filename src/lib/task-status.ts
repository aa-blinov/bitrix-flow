import type { TaskStatus } from '@/types/bitrix';

// Bitrix24: 1 — новая, 2 — ожидает выполнения, 3 — в работе,
// 4 — ждёт контроля, 5 — завершена, 6 — отложена.
export function mapBitrixTaskStatus(status: string): TaskStatus {
  switch (String(status)) {
    case '1':
    case '2':
      return 'new';
    case '3':
      return 'in_progress';
    case '4':
      return 'testing';
    case '5':
      return 'done';
    case '6':
      return 'deferred';
    default:
      return status;
  }
}
