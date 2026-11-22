// Привязка задачи к CRM хранится строками портала: L_7 лид, D_12 сделка, C_5 контакт,
// CO_3 компания, SI_4 счёт, T8f_4 смарт-процесс (тип в шестнадцатеричном виде).

export type CrmLink = { code: string; typeId: number; title: string };

const PREFIX_TYPE: Record<string, number> = { L: 1, D: 2, C: 3, CO: 4, SI: 31 };

export function crmEntityType(code: string): { typeId: number; id: number } | null {
  const match = /^([A-Z]+|T[0-9a-f]+)_(\d+)$/i.exec(code.trim());
  if (!match) return null;
  const [, prefix, id] = match;
  const typeId = /^T[0-9a-f]+$/i.test(prefix)
    ? parseInt(prefix.slice(1), 16)
    : PREFIX_TYPE[prefix.toUpperCase()];
  return typeId ? { typeId, id: Number(id) } : null;
}

// У контакта нет названия, только имя и фамилия.
export function crmItemLabel(item: { title?: string; name?: string; lastName?: string }) {
  return (
    String(item.title || '').trim() || [item.name, item.lastName].filter(Boolean).join(' ').trim()
  );
}

// Поиск идёт по четырём основным типам: смарт-процессы у каждого портала свои.
export const CRM_SEARCH_TYPES = [
  { typeId: 2, prefix: 'D', field: 'title' },
  { typeId: 3, prefix: 'C', field: 'lastName' },
  { typeId: 4, prefix: 'CO', field: 'title' },
  { typeId: 1, prefix: 'L', field: 'title' },
] as const;

export const CRM_TYPE_LABELS: Record<number, string> = {
  1: 'Лид',
  2: 'Сделка',
  3: 'Контакт',
  4: 'Компания',
  31: 'Счёт',
};
