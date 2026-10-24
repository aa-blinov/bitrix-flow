'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeToConnection, useSSE } from '@/hooks/useSSE';
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

const NOTIFY_KEY = 'bitrix-flow-chat-notify';

export function chatNotifyEnabled(): boolean {
  try {
    return (
      localStorage.getItem(NOTIFY_KEY) === '1' &&
      typeof Notification !== 'undefined' &&
      Notification.permission === 'granted'
    );
  } catch {
    return false;
  }
}

// Включение просит разрешение браузера: это можно только из клика пользователя.
export async function setChatNotify(on: boolean): Promise<boolean> {
  if (on) {
    if (typeof Notification === 'undefined') return false;
    const permission =
      Notification.permission === 'default'
        ? await Notification.requestPermission()
        : Notification.permission;
    if (permission !== 'granted') return false;
  }
  try {
    localStorage.setItem(NOTIFY_KEY, on ? '1' : '0');
  } catch {}
  return on;
}

// Короткий сигнал без звукового файла: ради одного звука ассет не нужен.
export function beep() {
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = 880;
    gain.gain.value = 0.05;
    oscillator.connect(gain).connect(context.destination);
    oscillator.start();
    oscillator.stop(context.currentTime + 0.12);
    oscillator.onended = () => void context.close();
  } catch {}
}

export function showChatNotification(event: MessengerEvent, onClick: () => void) {
  if (!chatNotifyEnabled()) return;
  beep();
  const title =
    event.chat && event.chat !== event.author ? event.chat : event.author || 'Сообщение';
  const body =
    event.chat && event.chat !== event.author ? `${event.author}: ${event.text}` : event.text;
  try {
    const notification = new Notification(title, { body, tag: `chat-${event.dialogId}` });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  } catch {}
}
