import { describe, expect, it } from 'vitest';
import {
  elementCode,
  elementFields,
  mapStatusElement,
  validateStatusPayload,
} from './project-status';

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
    const status = mapStatusElement({
      PROPERTY_PROJECT_ID: '10',
      PROPERTY_CLIENT: 'БСПБ',
      PROPERTY_STATUS: 'Ждёт договора',
      PROPERTY_STEP_DEADLINE: '20.11.2026',
    });
    expect(status).toMatchObject({ projectId: '10', client: 'БСПБ', status: 'Ждёт договора' });
    expect(status?.stepDeadline).toBe('2026-11-20T00:00:00.000Z');
  });

  it('элемент без проекта не попадает в сводку', () => {
    expect(mapStatusElement({}) === null).toBe(true);
  });
});

describe('elementCode', () => {
  it('стабильный код по проекту', () => {
    expect(elementCode('10')).toBe('project-10');
  });
});

describe('elementFields', () => {
  it('дата уходит в формате портала', () => {
    const fields = elementFields(
      validateStatusPayload({
        projectId: '10',
        stepDeadline: '2026-11-20T00:00:00.000Z',
      }),
    );
    expect(fields.PROPERTY_STEP_DEADLINE).toBe('20.11.2026');
  });
});
