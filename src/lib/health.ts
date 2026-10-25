// Состояние фоновых поллеров для /api/health. Статус ответа оно не меняет: докер по
// статусу перезапускает контейнер, а перезапуск не лечит сбой портала или токена.
// Поле warnings читает scripts/health-watch.sh и шлёт по нему алерт.

// Поллер задач ходит раз в минуту: пять минут тишины это уже сбой, а не пропущенный круг.
export const TASKS_STALE_S = 5 * 60;
// События чата читаются раз в три секунды, пока открыта вкладка.
export const MESSENGER_STALE_S = 60;
// Сразу после запуска первого прохода ещё не было.
export const GRACE_S = 7 * 60;

type PollerState = { lastOkAt: number; lastError: string };

export function pollerWarnings(input: {
  tasks: PollerState;
  chat: PollerState & { active: boolean };
  now: number;
  uptimeSeconds: number;
}): string[] {
  const { tasks, chat, now, uptimeSeconds } = input;
  const warnings: string[] = [];
  const reason = (error: string) => (error ? ` (${error.slice(0, 120)})` : '');

  const tasksAge = tasks.lastOkAt ? (now - tasks.lastOkAt) / 1000 : uptimeSeconds;
  if (uptimeSeconds > GRACE_S && tasksAge > TASKS_STALE_S)
    warnings.push(
      `tasks-poller-stale: ${Math.round(tasksAge)} с без успешного прохода${reason(tasks.lastError)}`,
    );

  const chatAge = (now - chat.lastOkAt) / 1000;
  if (chat.active && chat.lastOkAt && chatAge > MESSENGER_STALE_S)
    warnings.push(
      `messenger-events-stale: ${Math.round(chatAge)} с без успешного чтения${reason(chat.lastError)}`,
    );
  return warnings;
}
