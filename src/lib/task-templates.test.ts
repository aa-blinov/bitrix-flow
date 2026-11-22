import { describe, expect, it } from 'vitest';
import { normalizeTemplates, parseRecurrence, portalDay, replicateFields } from './task-templates';

describe('task-templates', () => {
  it('разбирает список шаблонов портала', () => {
    const [template] = normalizeTemplates({
      task_templates: {
        1: {
          ID: 1,
          TITLE: 'Отчёт',
          RESPONSIBLE_ID: 3,
          GROUP_ID: null,
          REPLICATE: 'N',
          SE_TAG: ['отчёт'],
        },
      },
    });
    expect(template).toMatchObject({ id: '1', responsibleId: '3', groupId: '0', recurrence: null });
    expect(template.tags).toEqual(['отчёт']);
  });
  it('повтор туда и обратно', () => {
    const weekly = { period: 'weekly' as const, weekDays: [1, 5], time: '10:00' };
    const fields = replicateFields(weekly, new Date(2026, 2, 16));
    expect(fields.REPLICATE).toBe('Y');
    expect(fields.REPLICATE_PARAMS).toMatchObject({
      WEEK_DAYS: [1, 5],
      START_DATE: '16.03.2026 00:00:00',
    });
    expect(parseRecurrence('Y', fields.REPLICATE_PARAMS)).toEqual(weekly);
    expect(replicateFields(null)).toEqual({ REPLICATE: 'N' });
    expect(parseRecurrence('N', { PERIOD: 'daily' })).toBeNull();
  });
  it('читает повтор из PHP-строки tasks.template.get', () => {
    // Строка с портала: шаблон «по средам и пятницам в 10:00».
    const raw =
      'a:5:{s:6:"PERIOD";s:6:"weekly";s:9:"WEEK_DAYS";a:2:{i:0;i:3;i:1;i:5;}s:4:"TIME";s:5:"10:00";s:8:"END_DATE";N;s:15:"MONTHLY_DAY_NUM";i:1;}';
    expect(parseRecurrence('Y', raw)).toEqual({
      period: 'weekly',
      weekDays: [3, 5],
      time: '10:00',
    });
  });
  it('дата портала с ведущими нулями', () => {
    expect(portalDay(new Date(2026, 0, 5))).toBe('05.01.2026 00:00:00');
  });
});
