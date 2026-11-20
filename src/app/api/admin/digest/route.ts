import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin';
import { digestConfig, previewDigest, saveDigestConfig, validDialogId } from '@/lib/digest';
import { toPlainText } from '@/lib/digest-delivery';

export const dynamic = 'force-dynamic';

// Настройки недельной сводки. Только админу: сообщение уходит от имени владельца токена
// портала, и получателя выбирает не каждый.
export function GET(req: NextRequest) {
  return withAdmin(req, async () => {
    const [config, text] = await Promise.all([digestConfig(), previewDigest().catch(() => '')]);
    return NextResponse.json({ config, preview: toPlainText(text) });
  });
}

export function PUT(req: NextRequest) {
  return withAdmin(req, async () => {
    const body = await req.json().catch(() => null);
    const dialogId = String(body?.dialogId ?? '').trim();
    const weekday = Number(body?.weekday);
    const hour = Number(body?.hour);
    if (
      !validDialogId(dialogId) ||
      !Number.isInteger(weekday) ||
      weekday < 0 ||
      weekday > 6 ||
      !Number.isInteger(hour) ||
      hour < 0 ||
      hour > 23
    )
      return NextResponse.json({ error: 'INVALID_SETTINGS' }, { status: 400 });
    await saveDigestConfig({ dialogId, weekday, hour });
    return NextResponse.json({ config: await digestConfig() });
  });
}
