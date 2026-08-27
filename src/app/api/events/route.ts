import { NextRequest } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/mongo';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

// SSE stream — браузер подключается и получает real-time события
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
      let lastSentId: ObjectId | null = latest[0]?._id || null;
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'connected' })}\n\n`));

      // Polling MongoDB каждую секунду для новых событий
      const interval = setInterval(async () => {
        try {
          const eventsDb = await getDb();
          const events = await eventsDb
            .collection('events_stream')
            .find({
              member_id: memberId,
              ...(lastSentId ? { _id: { $gt: lastSentId } } : {}),
            })
            .limit(10)
            .sort({ _id: 1 })
            .toArray();

          for (const e of events) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(e.event)}\n\n`));
            lastSentId = e._id;
          }
        } catch (err) {
          console.error('SSE poll error:', err);
        }
      }, 1000);

      // Heartbeat каждые 30 секунд
      const heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: heartbeat\n\n`));
      }, 30000);

      // Закрытие
      req.signal.addEventListener('abort', () => {
        clearInterval(interval);
        clearInterval(heartbeat);
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
