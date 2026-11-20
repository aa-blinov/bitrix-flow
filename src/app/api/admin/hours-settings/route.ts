import { NextRequest, NextResponse } from 'next/server';
import { withAdmin } from '@/lib/admin';
import { hoursSettings, normalizeHoursSettings, saveHoursSettings } from '@/lib/hours-settings';

export const dynamic = 'force-dynamic';

// Норма и служебные учётки меняют цифры всех отчётов по часам: правит только админ.
export function GET(req: NextRequest) {
  return withAdmin(req, async () => NextResponse.json({ settings: await hoursSettings() }));
}

export function PUT(req: NextRequest) {
  return withAdmin(req, async () => {
    const settings = normalizeHoursSettings(await req.json().catch(() => null));
    if (!settings) return NextResponse.json({ error: 'INVALID_SETTINGS' }, { status: 400 });
    await saveHoursSettings(settings);
    return NextResponse.json({ settings: await hoursSettings() });
  });
}
