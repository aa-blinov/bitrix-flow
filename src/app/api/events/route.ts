import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongo';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

// SSE stream — браузер подключается и получает real-time события.
//
// Раньше каждое соединение опрашивало MongoDB раз в секунду: две вкладки —
// два опроса, десять — десять. Теперь опрос один на сервер, а подписчики
// получают из него свои события.

type Subscriber = {
  memberId: string;
  /** Курсор подписчика: до какого события ему уже отдали. */
  lastSentId: ObjectId | null;
  enqueue: (chunk: string) => void;
};

const subscribers = new Set<Subscriber>();
let pump: NodeJS.Timeout | null = null;
let heartbeatTimer: NodeJS.Timeout | null = null;

async function queryEvents(memberId: string, after: ObjectId | null) {
  const db = await getDb();
  return db
    .collection('events_stream')
    .find({
      member_id: memberId,
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
    const list = byMember.get(subscriber.memberId) || [];
    list.push(subscriber);
    byMember.set(subscriber.memberId, list);
  }

  for (const [memberId, list] of byMember) {
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
      events = await queryEvents(memberId, oldest);
    } catch (error) {
      console.error('SSE poll error:', error);
      continue;
    }
    for (const subscriber of list) {
      for (const event of events) {
        if (subscriber.lastSentId && event._id <= subscriber.lastSentId) continue;
        subscriber.lastSentId = event._id;
        try {
          subscriber.enqueue(`data: ${JSON.stringify(event.event)}\n\n`);
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
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return new Response('Unauthorized', { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      // History is loaded through /api/notifications. Snapshot the cursor
      // before confirming connection so an event cannot be skipped in-between.
      const db = await getDb();
      const latest = await db
        .collection('events_stream')
        .find({ member_id: memberId })
        .sort({ _id: -1 })
        .limit(1)
        .toArray();
      const lastSentId: ObjectId | null = latest[0]?._id || null;

      const subscriber: Subscriber = {
        memberId,
        lastSentId,
        enqueue: (chunk) => controller.enqueue(encoder.encode(chunk)),
      };
      subscribers.add(subscriber);
      ensurePump();

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      req.signal.addEventListener('abort', () => {
        subscribers.delete(subscriber);
        controller.close();
      });
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
