'use client';

import { useEffect, useRef, useState } from 'react';
import { subscribeToConnection, useSSE } from '@/hooks/useSSE';
import { useKanbanStore } from '@/store/kanban';
import type { MessengerEvent } from '@/lib/messenger-events';
import { pingText } from '@/lib/ping';
import { t } from '@/lib/i18n';

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
  void syncPush(on);
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

export function showChatNotification(event: MessengerEvent, onClick: () => void) {
  if (!chatNotifyEnabled()) return;
  chime(event.mentioned);
  const { title, body } = pingText(event, {
    mention: t('Вас упомянули:'),
    message: t('Сообщение'),
  });
  try {
    const notification = new Notification(title, {
      body,
      tag: `chat-${event.dialogId}`,
      // Упоминание висит, пока его не закроют: обычное сообщение исчезает само.
      requireInteraction: event.mentioned,
    });
    notification.onclick = () => {
      window.focus();
      onClick();
      notification.close();
    };
  } catch {}
}

// Пуш в закрытую вкладку: service worker и подписка браузера. Сбой не мешает обычным
// уведомлениям, они работают и без пуша (например, когда сервер без VAPID-ключей).
function urlBase64ToBytes(value: string) {
  const padded = value + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export async function syncPush(on: boolean) {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
    const registration = await navigator.serviceWorker.register('/sw.js');
    const existing = await registration.pushManager.getSubscription();
    if (!on) {
      if (existing) {
        await fetch('/api/push', {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ endpoint: existing.endpoint }),
        });
        await existing.unsubscribe();
      }
      return;
    }
    const response = await fetch('/api/push');
    if (!response.ok) return;
    const { key } = await response.json();
    const subscription =
      existing ||
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBytes(key),
      }));
    await fetch('/api/push', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: subscription.toJSON() }),
    });
  } catch {}
}
