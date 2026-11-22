import { describe, expect, it } from 'vitest';
import { crmEntityType, crmItemLabel } from './crm-links';

describe('crm-links', () => {
  it('разбирает коды привязок портала', () => {
    expect(crmEntityType('D_12')).toEqual({ typeId: 2, id: 12 });
    expect(crmEntityType('CO_3')).toEqual({ typeId: 4, id: 3 });
    expect(crmEntityType('T8f_4')).toEqual({ typeId: 143, id: 4 });
    expect(crmEntityType('X_1')).toBeNull();
    expect(crmEntityType('мусор')).toBeNull();
  });
  it('у контакта подпись из имени и фамилии', () => {
    expect(crmItemLabel({ name: 'Иван', lastName: 'Петров' })).toBe('Иван Петров');
    expect(crmItemLabel({ title: 'Сделка' })).toBe('Сделка');
  });
});
