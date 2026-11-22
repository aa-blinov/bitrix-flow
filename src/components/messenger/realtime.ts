'use client';

import { useEffect, useRef, useState } from 'react';
import { CHAT_NOTIFY_KEY, reconnectSSE, subscribeToConnection, useSSE } from '@/hooks/useSSE';
import { useKanbanStore } from '@/store/kanban';
import type { MessengerEvent } from '@/lib/messenger-events';

// События чата идут тем же SSE, что и события задач: отдельного соединения не нужно.
export function useMessengerEvents(handler: (event: MessengerEvent) => void) {
  const memberId = useKanbanStore((state) => state.memberId);
  useSSE(memberId, (event) => {
    if (event?.type === 'messenger') handler(event as MessengerEvent);
  });
}

// Пока SSE жив, события заменяют опрос и он идёт редко, только подстраховкой.
// Когда связь пропала, возвращаем частый опрос, чтобы переписка не замерзала.
export function useRealtime() {
  const [online, setOnline] = useState(false);
  useEffect(() => subscribeToConnection((state) => setOnline(state === 'online')), []);
  return online;
}

// Откладывает вызов: пачка событий подряд даёт один запрос, а не десять.
export function useDebounced(run: () => void, delay: number) {
  const timer = useRef<number | null>(null);
  const latest = useRef(run);
  useEffect(() => {
    latest.current = run;
  });
  useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
    },
    [],
  );
  return () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => latest.current(), delay);
  };
}

const NOTIFY_KEY = CHAT_NOTIFY_KEY;

export function chatNotifyEnabled(): boolean {
  try {
    // Без выбора звук включён на упоминания: иначе новичок не услышит, что его позвали,
    // пока сам не найдёт кнопку.
    return localStorage.getItem(NOTIFY_KEY) !== '0';
  } catch {
    return false;
  }
}

// Пушей в браузер больше нет: сигнал живёт только внутри приложения — звук и значок
// непрочитанных, поэтому разрешение браузера не нужно.
export async function setChatNotify(on: boolean): Promise<boolean> {
  try {
    localStorage.setItem(NOTIFY_KEY, on ? '1' : '0');
  } catch {}
  reconnectSSE();
  return on;
}

let audio: AudioContext | null = null;

// Сигнал без звукового файла: ради двух звуков ассет не нужен. Ровный синус с резким обрывом
// щёлкал и звучал как ошибка, поэтому каждая нота с быстрой атакой и затуханием, как колокольчик.
// Упоминание звучит тремя нотами вверх, чтобы его отличали от обычного сообщения на слух.
export function chime(mentioned = false) {
  try {
    // Один контекст на вкладку: браузер ограничивает их число, а новый после автоплея
    // стартует приостановленным.
    audio ??= new AudioContext();
    void audio.resume();
    const notes = mentioned ? [784, 988, 1319] : [880, 1175];
    const start = audio.currentTime + 0.01;
    notes.forEach((frequency, index) => {
      const at = start + index * 0.09;
      const oscillator = audio!.createOscillator();
      const gain = audio!.createGain();
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.08, at + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.45);
      oscillator.connect(gain).connect(audio!.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.5);
    });
  } catch {}
}

/** Диалог прочитан на портале: счётчик в меню перечитывается сразу, а не через минуту. */
export const CHAT_READ_EVENT = 'messenger:read';
/** Открыть диалог на уже открытой странице чата (переход из уведомления). */
export const CHAT_OPEN_EVENT = 'messenger:open';

// Каждая открытая вкладка получает то же событие: звенит и показывает уведомление
// только та, что первой взяла блокировку на это сообщение.
// inView: вкладка показывает этот диалог. Она берёт блокировку сразу и молчит, а
// остальные ждут немного, чтобы не опередить её и не звенеть о видимом сообщении.
const SHOWN_KEY = 'bitrix-flow-chat-shown';
function alreadyShown(key: string): boolean {
  try {
    const now = Date.now();
    const shown: Record<string, number> = JSON.parse(localStorage.getItem(SHOWN_KEY) || '{}');
    for (const [old, at] of Object.entries(shown)) if (now - at > 10 * 60_000) delete shown[old];
    const seen = key in shown;
    shown[key] = now;
    localStorage.setItem(SHOWN_KEY, JSON.stringify(shown));
    return seen;
  } catch {
    return false;
  }
}

// inView спрашивается в момент показа: за 300 мс ожидания человек мог открыть диалог.
export function showChatNotification(
  event: MessengerEvent,
  inView: () => boolean,
  onClick: () => void,
) {
  if (!chatNotifyEnabled()) return;
  if (!navigator.locks) {
    if (!inView()) notify(event, onClick);
    return;
  }
  const take = () =>
    navigator.locks
      .request(
        `chat-alert-${event.dialogId}-${event.messageId}`,
        { ifAvailable: true },
        async (lock) => {
          if (!lock) return;
          // Вкладка, разбуженная браузером позже пяти секунд, взяла бы блокировку заново:
          // факт показа помним в общем для вкладок хранилище ещё десять минут.
          if (alreadyShown(`${event.dialogId}:${event.messageId}`)) return;
          if (!inView()) notify(event, onClick);
          // Держим блокировку, пока событие доходит до остальных вкладок.
          await new Promise((resolve) => setTimeout(resolve, 5000));
        },
      )
      .catch(() => {});
  if (inView()) void take();
  else window.setTimeout(() => void take(), 300);
}

function notify(event: MessengerEvent, _onClick: () => void) {
  // Уведомления могли выключить за время ожидания других вкладок.
  if (!chatNotifyEnabled()) return;
  // Режим «только упоминания»: обычные сообщения молча попадают в значок.
  try {
    if (localStorage.getItem('bitrix-flow-chat-notify-mode') !== 'all' && !event.mentioned) return;
  } catch {}
  // Внутри приложения виден значок непрочитанных, поэтому сигнал здесь — только звук.
  chime(event.mentioned);
}
