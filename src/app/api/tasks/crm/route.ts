import { NextRequest, NextResponse } from 'next/server';
import { withMessenger } from '@/lib/messenger-api';
import { CRM_SEARCH_TYPES, crmEntityType, crmItemLabel, type CrmLink } from '@/lib/crm-links';

export const dynamic = 'force-dynamic';

// CRM читается токеном самого человека (обвязка общая с мессенджером): он видит в карточке
// только те сделки и контакты, к которым у него есть доступ в портале. В прокси задач
// crm.* не открываем: там список методов закрыт от украденной сессии.
export function GET(req: NextRequest) {
  const ids = (req.nextUrl.searchParams.get('ids') || '').split(',').filter(Boolean).slice(0, 30);
  const q = (req.nextUrl.searchParams.get('q') || '').trim().slice(0, 60);
  return withMessenger(req, async (call) => {
    if (ids.length) {
      // Привязки группируются по типу: один запрос на тип, а не на каждую.
      const byType = new Map<number, number[]>();
      for (const code of ids) {
        const parsed = crmEntityType(code);
        if (!parsed) continue;
        byType.set(parsed.typeId, [...(byType.get(parsed.typeId) || []), parsed.id]);
      }
      const found = new Map<string, CrmLink>();
      await Promise.all(
        [...byType].map(async ([typeId, list]) => {
          const result = await call(
            'crm.item.list',
            {
              entityTypeId: typeId,
              select: ['id', 'title', 'name', 'lastName'],
              filter: { '@id': list },
              // Фильтр с массивом форма не передаст: тело уходит JSON.
            },
            false,
            true,
          ).catch(() => null);
          for (const item of result?.items || []) {
            const code = ids.find((value) => {
              const parsed = crmEntityType(value);
              return parsed?.typeId === typeId && parsed.id === Number(item.id);
            });
            if (code) found.set(code, { code, typeId, title: crmItemLabel(item) });
          }
        }),
      );
      // Элемент без доступа или удалённый не пропадает: показываем его кодом.
      const links = ids.map(
        (code) => found.get(code) || { code, typeId: crmEntityType(code)?.typeId || 0, title: '' },
      );
      return NextResponse.json({ links });
    }
    if (q.length < 2) return NextResponse.json({ links: [] });
    const lists = await Promise.all(
      CRM_SEARCH_TYPES.map(async ({ typeId, prefix, field }) => {
        const result = await call(
          'crm.item.list',
          {
            entityTypeId: typeId,
            select: ['id', 'title', 'name', 'lastName'],
            filter: { [`%${field}`]: q },
            order: { id: 'desc' },
          },
          false,
          true,
        ).catch(() => null);
        return (result?.items || []).slice(0, 5).map((item: any) => ({
          code: `${prefix}_${item.id}`,
          typeId,
          title: crmItemLabel(item),
        }));
      }),
    );
    return NextResponse.json({ links: lists.flat() });
  });
}
