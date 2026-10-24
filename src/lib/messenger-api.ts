import { NextRequest, NextResponse } from 'next/server';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
import { bx24OAuth } from '@/lib/oauth-client';
import { isMockEnabled, mockHandle } from '@/lib/mock-b24';

// Общая обвязка роутов мессенджера: сессия, мок для UI-тестов и единая
// форма ошибки. Методы im.* отсюда не светятся в allowlist прокси задач:
// мессенджер ходит только через свои роуты с проверкой DIALOG_ID.
export async function withMessenger(
  req: NextRequest,
  run: (
    call: (method: string, params?: Record<string, string>, mutation?: boolean) => Promise<any>,
  ) => Promise<NextResponse>,
): Promise<NextResponse> {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'MEMBER_ID_REQUIRED' }, { status: 401 });

  const call = async (method: string, params: Record<string, string> = {}, mutation = false) => {
    if (isMockEnabled()) return mockHandle(method, params);
    // Повтор POST отправил бы сообщение дважды, поэтому гонка адресов только на чтении.
    return bx24OAuth(memberId, method, params, { parallel: !mutation });
  };

  try {
    return await run(call);
  } catch (error) {
    console.error('[messenger]', error);
    return NextResponse.json(
      { error: 'BITRIX24_REQUEST_FAILED', message: error instanceof Error ? error.message : '' },
      { status: 502 },
    );
  }
}
