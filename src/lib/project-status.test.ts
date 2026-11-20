import { describe, expect, it } from 'vitest';
import {
  FIELD_LABELS,
  buildFieldMap,
  elementCode,
  elementFields,
  mapStatusElement,
  toIsoDate,
  validateStatusPayload,
} from './project-status';

// Карта поля по названию, как её строит buildFieldMap с портала.
const fieldMap = Object.fromEntries(
  Object.values(FIELD_LABELS).map((label) => [label, `PROPERTY_${label.replace(/\s/g, '_')}`]),
) as Record<string, string>;

describe('validateStatusPayload', () => {
  it('принимает корректный payload', () => {
    const values = validateStatusPayload({
      projectId: '10',
      status: 'В работе',
      ownerId: '1',
      stepDeadline: '2026-03-20T00:00:00.000Z',
      goal: 'x'.repeat(10_000),
    });
    expect(values).toMatchObject({
      projectId: '10',
      status: 'В работе',
      ownerId: '1',
    });
  });

  it('отбрасывает неизвестные статусы и нецифровой проект', () => {
    expect(validateStatusPayload({ projectId: '10', status: 'Гадание' }).status).toBe('');
    expect(() => validateStatusPayload({ projectId: 'abc' })).toThrow('VALIDATION_FAILED');
  });

  it('обрезает слишком длинные тексты в пустую строку', () => {
    expect(validateStatusPayload({ projectId: '10', risk: 'x'.repeat(10_001) }).risk).toBe('');
  });
});

describe('mapStatusElement', () => {
  it('маппит поля элемента списка', () => {
    const status = mapStatusElement(
      {
        PROPERTY_ID_проекта: '10',
        PROPERTY_Клиент: 'БСПБ',
        PROPERTY_Статус: 'Ждёт договора',
        PROPERTY_Срок_шага: '20.11.2026',
      },
      fieldMap,
    );
    expect(status).toMatchObject({ projectId: '10', client: 'БСПБ', status: 'Ждёт договора' });
    expect(status?.stepDeadline).toBe('2026-11-20T00:00:00.000Z');
  });

  it('элемент без проекта не попадает в сводку', () => {
    expect(mapStatusElement({}, fieldMap) === null).toBe(true);
  });
});

describe('elementCode', () => {
  it('стабильный код по проекту', () => {
    expect(elementCode('10')).toBe('project-10');
  });
});

describe('elementFields', () => {
  it('дата уходит в формате портала', () => {
    const values = validateStatusPayload({
      projectId: '10',
      stepDeadline: '2026-11-20T00:00:00.000Z',
    });
    const fields = elementFields(values, fieldMap);
    expect(fields[fieldMap['Срок шага']]).toBe('20.11.2026');
  });
});

describe('toIsoDate', () => {
  it('читает дд.мм.гггг как день и месяц, а не наоборот', () => {
    expect(toIsoDate('03.04.2026')).toBe('2026-04-03T00:00:00.000Z');
    expect(toIsoDate('20.03.2026 10:00:00')).toBe('2026-03-20T00:00:00.000Z');
    expect(toIsoDate('2026-03-20')).toBe('2026-03-20T00:00:00.000Z');
    expect(toIsoDate('ерунда')).toBe('');
  });
});

describe('buildFieldMap', () => {
  it('передаёт код списка: без него портал не отдаёт поля', async () => {
    const calls: Record<string, unknown>[] = [];
    const map = await buildFieldMap(async (_method, params) => {
      calls.push(params);
      return { PROPERTY_1: { NAME: 'Клиент', FIELD_ID: 'PROPERTY_1' } };
    });
    expect(calls[0]).toMatchObject({ IBLOCK_CODE: 'project_status' });
    expect(map).toEqual({ Клиент: 'PROPERTY_1' });
  });
});
