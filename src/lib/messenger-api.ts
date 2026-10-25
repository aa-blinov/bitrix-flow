import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { bx24OAuth } from '@/lib/oauth-client';
import { getDb } from '@/lib/mongo';
import { isMockEnabled, mockHandle } from '@/lib/mock-b24';

// Общая обвязка роутов мессенджера: сессия, мок для UI-тестов и единая
// форма ошибки. Методы im.* отсюда не светятся в allowlist прокси задач:
// мессенджер ходит только через свои роуты с проверкой DIALOG_ID.
export async function withMessenger(
  req: NextRequest,
  run: (
    call: (
      method: string,
      params?: Record<string, unknown>,
      mutation?: boolean,
      json?: boolean,
    ) => Promise<any>,
    memberId: string,
  ) => Promise<NextResponse>,
): Promise<NextResponse> {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 401 });

  const call = async (
    method: string,
    params: Record<string, unknown> = {},
    mutation = false,
    json = false,
  ) => {
    if (isMockEnabled()) return mockHandle(method, params as Record<string, string>);
    // Повтор POST отправил бы сообщение дважды, поэтому гонка адресов только на чтении.
    // json нужен методам im.v2.*: вложенные fields форма передать не может.
    return bx24OAuth(memberId, method, params, { parallel: !mutation, json });
  };

  try {
    return await run(call, memberId);
  } catch (error) {
    console.error('[messenger]', error);
    return NextResponse.json(
      { error: 'BITRIX24_REQUEST_FAILED', message: error instanceof Error ? error.message : '' },
      { status: 502 },
    );
  }
}

// Адрес портала для ссылок «открыть в Битриксе»: там есть то, чего нет у приложения
// (звонки и видеоконференции, которые REST создавать не умеет).
export async function portalDomain(memberId: string): Promise<string> {
  const db = await getDb();
  const token = await db
    .collection('user_tokens')
    .findOne({ member_id: memberId }, { projection: { domain: 1 } });
  return /^[a-z0-9.-]+$/i.test(String(token?.domain || '')) ? String(token?.domain) : '';
}
