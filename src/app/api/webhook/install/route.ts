// Endpoint для установки webhook handler'а в Bitrix24
// Битрикс24 сам шлет события на этот URL когда они происходят

import { NextRequest, NextResponse } from 'next/server';
import { bx24OAuth } from '@/lib/oauth-client';

export async function POST(req: NextRequest) {
  const { member_id, webhook_url } = await req.json();

  if (!member_id || !webhook_url) {
    return NextResponse.json({ error: 'member_id and webhook_url required' }, { status: 400 });
  }

  try {
    // Регистрируем обработчик событий
    const result = await bx24OAuth(member_id, 'event.bind', {
      EVENT: 'task',
      EVENT_TYPE: 'add|update|delete',
      HANDLER: webhook_url,
    });

    return NextResponse.json({ success: true, result });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
