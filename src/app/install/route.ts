import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';

const APP_URL = process.env.BITRIX24_APP_URL || 'http://57.131.129.41:3000';

// Путь первоначальной установки - Битрикс24 перенаправляет сюда когда
// пользователь устанавливает приложение. Содержит auth токен в URL.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);

  const member_id = searchParams.get('member_id');
  const auth = searchParams.get('AUTH');
  const domain = searchParams.get('DOMAIN');
  const lang = searchParams.get('LANG') || 'ru';
  const app_sid = searchParams.get('APP_SID');

  console.log('[INSTALL]', { member_id, domain, lang });

  // Если есть auth - сохраняем и редиректим в приложение
  if (member_id && auth) {
    try {
      const db = await getDb();
      const realDomain = domain && !domain.includes('bitrix.info') ? domain : 'eora.bitrix24.ru';
      await db.collection('user_tokens').updateOne(
        { member_id },
        {
          $set: {
            member_id,
            access_token: auth,
            domain: realDomain,
            lang,
            app_sid,
            application_token: searchParams.get('APPLICATION_TOKEN') || undefined,
            scope: 'tasks,sonet_group,user,calendar,im',
            updated_at: new Date(),
            installed_at: new Date(),
          },
        },
        { upsert: true },
      );
    } catch (err) {
      console.error('Save install error:', err);
    }

    const APP_URL = process.env.BITRIX24_APP_URL || 'http://57.131.129.41:3000';
    return NextResponse.redirect(`${APP_URL}/?install=success&member_id=${member_id}`);
  }

  // Если нет auth - показываем страницу установки
  return new NextResponse(getInstallHtml(domain || ''), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function getInstallHtml(domain: string) {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Bitrix24 Kanban - Установка</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); min-height: 100vh; display: flex; align-items: center; justify-content: center; margin: 0; padding: 20px; }
    .card { background: white; padding: 40px; border-radius: 16px; box-shadow: 0 20px 60px rgba(0,0,0,0.3); max-width: 480px; width: 100%; text-align: center; }
    .icon { width: 64px; height: 64px; margin: 0 auto 20px; background: linear-gradient(135deg, #3b82f6, #1d4ed8); border-radius: 16px; display: flex; align-items: center; justify-content: center; }
    .icon svg { width: 32px; height: 32px; fill: white; }
    h1 { margin: 0 0 8px; font-size: 24px; color: #111; }
    .domain { color: #6b7280; font-size: 14px; margin-bottom: 24px; }
    p { color: #4b5563; line-height: 1.6; margin-bottom: 24px; }
    .features { text-align: left; background: #f9fafb; padding: 16px; border-radius: 12px; }
    .features li { padding: 6px 0; color: #4b5563; font-size: 14px; list-style: none; }
    .features li::before { content: "✓ "; color: #10b981; font-weight: bold; margin-right: 6px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg viewBox="0 0 24 24"><path d="M3 3h7v7H3V3zm11 0h7v7h-7V3zm0 11h7v7h-7v-7zM3 14h7v7H3v-7z"/></svg>
    </div>
    <h1>Bitrix24 Kanban</h1>
    ${domain ? `<p class="domain">${domain}</p>` : ''}
    <p>Современный интерфейс управления проектами в стиле Asana для Битрикс24</p>
    <ul class="features">
      <li>Канбан-доска с реальной синхронизацией</li>
      <li>Все этапы проекта отображаются</li>
      <li>Учёт времени и оценка задач</li>
      <li>Комментарии в реальном времени</li>
      <li>Real-time обновления через SSE</li>
    </ul>
  </div>
</body>
</html>`;
}
