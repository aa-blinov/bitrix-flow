import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedPerson } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { bx24OAuth } from '@/lib/oauth-client';
import { getDb } from '@/lib/mongo';
import { isMockEnabled, mockHandle } from '@/lib/mock-b24';

// Общая обвязка роутов мессенджера: сессия, мок для UI-тестов и единая
// форма ошибки. Методы im.* отсюда не светятся в allowlist прокси задач:
// мессенджер ходит только через свои роуты с проверкой DIALOG_ID.
// 502 значит «связь с порталом оборвалась»: мутация могла выполниться, клиент просит
// проверить чат. Ответ портала с кодом ошибки (нет прав, чат не найден) это точный
// отказ, ему 422: такую операцию можно спокойно повторить или объяснить причину.
// Ошибки транспорта называет сам bitrix-request (BITRIX24_…) или Node (код errno).
export function isTransportFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return /^BITRIX24_/.test(message) || Boolean((error as NodeJS.ErrnoException)?.code);
}

export async function withMessenger(
  req: NextRequest,
  run: (
    call: (
      method: string,
      params?: Record<string, unknown> | unknown[],
      mutation?: boolean,
      json?: boolean,
      v3?: boolean,
    ) => Promise<any>,
    memberId: string,
    userId: string,
  ) => Promise<NextResponse>,
): Promise<NextResponse> {
  // Мессенджер это личная переписка: только токен самого человека, никогда портала.
  const person = await getAuthorizedPerson(req.cookies.get(sessionCookie.name)?.value);
  if (!person) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 401 });
  const { memberId } = person;

  const call = async (
    method: string,
    params: Record<string, unknown> | unknown[] = {},
    mutation = false,
    json = false,
    v3 = false,
  ) => {
    if (isMockEnabled()) return mockHandle(method, params as Record<string, string>);
    // Повтор POST отправил бы сообщение дважды, поэтому гонка адресов только на чтении.
    // json нужен методам im.v2.*: вложенные fields форма передать не может.
    return bx24OAuth(memberId, method, params, {
      parallel: !mutation,
      json,
      v3,
      asUser: person.userId,
    });
  };

  try {
    return await run(call, memberId, person.userId);
  } catch (error) {
    console.error('[messenger]', error);
    return NextResponse.json(
      {
        error: 'BITRIX24_REQUEST_FAILED',
        message: error instanceof Error ? error.message : '',
        code: String((error as { portalCode?: string })?.portalCode || ''),
      },
      { status: isTransportFailure(error) ? 502 : 422 },
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
