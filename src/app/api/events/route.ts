import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongo';
import { getAuthorizedPerson } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

// SSE stream — браузер подключается и получает real-time события.
//
// Раньше каждое соединение опрашивало MongoDB раз в секунду: две вкладки —
// два опроса, десять — десять. Теперь опрос один на сервер, а подписчики
// получают из него свои события.

type Subscriber = {
  memberId: string;
  /** Чья вкладка: события его переписки уходят только ему. */
  userId: string;
  /** Курсор подписчика: до какого события ему уже отдали. */
  lastSentId: ObjectId | null;
  /** Когда курсор вкладки зафиксирован: событие, записанное раньше, ей не дойдёт. */
  readyAt: number;
  /** Вкладка показывает уведомления о чате: только такая заменяет пуш. */
  alerts: boolean;
  enqueue: (chunk: string) => void;
};

const subscribers = new Set<Subscriber>();
// Поллер событий чата читает очередь портала только пока есть открытые вкладки.
globalThis.__sseSubscribers = subscribers;
let pump: NodeJS.Timeout | null = null;
const RESUME_WINDOW_MS = 5 * 60_000;
let heartbeatTimer: NodeJS.Timeout | null = null;

// События задач общие на портал (без user_id), события чата личные (с user_id своего человека).
async function queryEvents(memberId: string, userId: string, after: ObjectId | null) {
  const db = await getDb();
  return db
    .collection('events_stream')
    .find({
      member_id: memberId,
      // Старые события чата без user_id (до токенов по людям) не отдаём никому.
      $or: [
        { user_id: { $exists: false }, 'event.type': { $ne: 'messenger' } },
        { user_id: userId },
      ],
      ...(after ? { _id: { $gt: after } } : {}),
    })
    .limit(50)
    .sort({ _id: 1 })
    .toArray();
}

// Один проход в секунду на всех подписчиков: забираем события с самой
// ранней позиции, а каждому подписчику отдаём только те, что он ещё не видел.
async function pumpOnce() {
  const byMember = new Map<string, Subscriber[]>();
  for (const subscriber of subscribers) {
    const key = `${subscriber.memberId}:${subscriber.userId}`;
    const list = byMember.get(key) || [];
    list.push(subscriber);
    byMember.set(key, list);
  }

  for (const list of byMember.values()) {
    const { memberId, userId } = list[0];
    let oldest: ObjectId | null = null;
    for (const subscriber of list) {
      if (!subscriber.lastSentId) {
        oldest = null;
        break;
      }
      if (!oldest || subscriber.lastSentId < oldest) oldest = subscriber.lastSentId;
    }
    let events: Awaited<ReturnType<typeof queryEvents>> = [];
    try {
      events = await queryEvents(memberId, userId, oldest);
    } catch (error) {
      console.error('SSE poll error:', error);
      continue;
    }
    for (const subscriber of list) {
      for (const event of events) {
        if (subscriber.lastSentId && event._id <= subscriber.lastSentId) continue;
        subscriber.lastSentId = event._id;
        try {
          // id нужен браузеру: после разрыва он сам пришлёт Last-Event-ID.
          subscriber.enqueue(`id: ${event._id}\ndata: ${JSON.stringify(event.event)}\n\n`);
        } catch {
          // Подписчик отключился между выборкой и отправкой.
        }
      }
    }
  }
}

function ensurePump() {
  if (pump) return;
  pump = setInterval(() => {
    if (!subscribers.size) return;
    void pumpOnce();
  }, 1000);
  heartbeatTimer = setInterval(() => {
    for (const subscriber of subscribers) {
      try {
        subscriber.enqueue(': heartbeat\n\n');
      } catch {}
    }
  }, 30000);
}

export async function GET(req: NextRequest) {
  const person = await getAuthorizedPerson(req.cookies.get(sessionCookie.name)?.value);
  if (!person) return new Response('Unauthorized', { status: 401 });
  const { memberId, userId } = person;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // Вкладку могут закрыть, пока ждём базу: отмену ловим до первого await, иначе
      // подписчик остался бы навсегда и подавлял пуши за несуществующую вкладку.
      let closed = req.signal.aborted;
      let subscriber: Subscriber | null = null;
      req.signal.addEventListener('abort', () => {
        closed = true;
        if (subscriber) subscribers.delete(subscriber);
        try {
          controller.close();
        } catch {}
      });
      // History is loaded through /api/notifications. Snapshot the cursor
      // before confirming connection so an event cannot be skipped in-between.
      const db = await getDb();
      const latest = await db
        .collection('events_stream')
        .find({ member_id: memberId })
        .sort({ _id: -1 })
        .limit(1)
        .toArray();
      // Переподключение после разрыва продолжает с последнего полученного события: иначе
      // сообщение, пришедшее за время разрыва, осталось бы без уведомления. Досылаем только
      // события последних минут: после сна ноутбука звон о давнем только мешает. Граница по
      // времени самих событий, а не последнего полученного: тот мог прийти и час назад.
      const resume =
        req.headers.get('last-event-id') || req.nextUrl.searchParams.get('after') || '';
      const resumeId =
        ObjectId.isValid(resume) && resume.length === 24 ? new ObjectId(resume) : null;
      const floor = ObjectId.createFromTime(Math.floor((Date.now() - RESUME_WINDOW_MS) / 1000));
      const lastSentId: ObjectId | null = resumeId
        ? resumeId.getTimestamp() > floor.getTimestamp()
          ? resumeId
          : floor
        : latest[0]?._id || null;

      if (closed) return;
      subscriber = {
        memberId,
        userId,
        lastSentId,
        readyAt: Date.now(),
        alerts: req.nextUrl.searchParams.get('alerts') === '1',
        enqueue: (chunk) => controller.enqueue(encoder.encode(chunk)),
      };
      subscribers.add(subscriber);
      ensurePump();

      // Курсор с самого начала: если связь оборвётся до первого события, браузер
      // переподключится с этим Last-Event-ID и получит пришедшее за время разрыва.
      const cursor = lastSentId || ObjectId.createFromTime(Math.floor(Date.now() / 1000));
      controller.enqueue(
        encoder.encode(`id: ${cursor}\ndata: ${JSON.stringify({ type: 'connected' })}\n\n`),
      );
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
    },
  });
}
