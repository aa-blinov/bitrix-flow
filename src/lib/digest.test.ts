import { describe, expect, it } from 'vitest';
import { buildDigest, shouldSendDigest } from './digest';

describe('digest', () => {
  it('lists the worst projects and people and skips clean ones', () => {
    const text = buildDigest({
      date: '25 октября',
      total: { open: 40, overdue: 7, noDeadline: 5 },
      projects: [
        { name: 'API v2', open: 20, overdue: 5, noDeadline: 2 },
        { name: 'Маркетинг', open: 10, overdue: 2, noDeadline: 0 },
        { name: 'Бэклог', open: 10, overdue: 0, noDeadline: 3 },
      ],
      people: [{ name: 'Анна', open: 12, overdue: 4, noDeadline: 0 }],
    });
    expect(text).toContain('[B]Сводка BitrixFlow на 25 октября[/B]');
    expect(text).toContain('Открытых задач 40, просрочено 7, без срока 5.');
    expect(text.indexOf('API v2')).toBeLessThan(text.indexOf('Маркетинг'));
    expect(text).not.toContain('Бэклог');
    expect(text).toContain('Анна: просрочено 4 из 12');
  });

  it('says there is nothing overdue when there is nothing', () => {
    const text = buildDigest({
      date: '25 октября',
      total: { open: 3, overdue: 0, noDeadline: 0 },
      projects: [{ name: 'API v2', open: 3, overdue: 0, noDeadline: 0 }],
      people: [],
    });
    expect(text).toContain('Просрочек нет.');
  });

  it('fires on the chosen weekday from the chosen hour', () => {
    const monday = (h: number) => new Date(2026, 9, 26, h, 0, 0);
    expect(shouldSendDigest(monday(8), 1, 9)).toBe(false);
    expect(shouldSendDigest(monday(9), 1, 9)).toBe(true);
    expect(shouldSendDigest(new Date(2026, 9, 27, 10), 1, 9)).toBe(false);
  });
});
