import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import { normalizePosts } from '@/lib/project-life';

export const dynamic = 'force-dynamic';

const groupId = (value: unknown) => (/^\d+$/.test(String(value || '')) ? String(value) : '');

// Лента проекта читается и пишется токеном человека: портал сам отдаёт только те посты,
// которые ему видны. Обвязка общая с мессенджером.
export function GET(req: NextRequest) {
  const id = groupId(req.nextUrl.searchParams.get('projectId'));
  if (!id) return Promise.resolve(NextResponse.json({ error: 'BAD_PROJECT' }, { status: 400 }));
  return withMessenger(req, async (call) => {
    const result = await call(
      'log.blogpost.get',
      { LOG_RIGHTS: [`SG${id}`], LIMIT: 30 },
      false,
      true,
    );
    return NextResponse.json({ posts: normalizePosts(result) });
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const id = groupId(body?.projectId);
  const text = String(body?.text || '')
    .trim()
    .slice(0, 20_000);
  const title = String(body?.title || '')
    .trim()
    .slice(0, 255);
  if (!id || !text) return NextResponse.json({ error: 'EMPTY_POST' }, { status: 400 });
  return withMessenger(req, async (call) => {
    const result = await call(
      'log.blogpost.add',
      // Без заголовка портал считает пост коротким и подписывает его началом текста.
      { POST_TITLE: title, POST_MESSAGE: text, DEST: [`SG${id}`] },
      true,
      true,
    );
    return NextResponse.json({ id: String(result?.id ?? result ?? '') });
  });
}
