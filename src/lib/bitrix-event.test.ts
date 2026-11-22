import { describe, expect, it } from 'vitest';
import { eventFields } from './bitrix-event';

describe('eventFields', () => {
  it('у удаления берёт FIELDS_BEFORE, а не строку «undefined»', () => {
    // Тело ONTASKDELETE из документации портала.
    const raw = { FIELDS_BEFORE: { ID: 123 }, FIELDS_AFTER: 'undefined', IS_ACCESSIBLE_AFTER: 'N' };
    expect(eventFields(raw).ID).toBe(123);
    expect(eventFields({ FIELDS_BEFORE: { ID: 1 }, FIELDS_AFTER: { ID: 2 } }).ID).toBe(2);
    expect(eventFields(undefined)).toEqual({});
  });
});
