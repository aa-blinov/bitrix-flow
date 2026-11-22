import { describe, expect, it } from 'vitest';
import { ganttSpan, normalizeLinks } from './gantt';

describe('gantt', () => {
  it('плановые даты важнее создания и срока', () => {
    const span = ganttSpan({
      planStart: '2026-03-02T09:00:00Z',
      planEnd: '2026-03-06T18:00:00Z',
      createdDate: '2026-01-01T00:00:00Z',
      dueDate: '2026-04-01T00:00:00Z',
    });
    expect(span?.planned).toBe(true);
    expect(new Date(span!.start).toISOString()).toBe('2026-03-02T09:00:00.000Z');
  });
  it('без плана полоса от создания до срока, без срока в один день', () => {
    expect(
      ganttSpan({ createdDate: '2026-03-01T00:00:00Z', dueDate: '2026-03-05T00:00:00Z' })?.planned,
    ).toBe(false);
    const short = ganttSpan({ createdDate: '2026-03-01T00:00:00Z' })!;
    expect(short.end - short.start).toBe(86_400_000);
    expect(ganttSpan({})).toBeNull();
  });
  it('разбирает связи v3 в обоих видах ответа', () => {
    const link = { taskId: 102, dependentId: 101, type: 'finish_start' };
    expect(normalizeLinks([link])).toEqual([{ from: '101', to: '102', type: 'finish_start' }]);
    expect(normalizeLinks({ items: [link] })).toHaveLength(1);
    expect(normalizeLinks(null)).toEqual([]);
  });
});
