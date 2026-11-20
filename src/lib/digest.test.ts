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

  it('fires on the chosen weekday from the chosen hour, by Moscow time', () => {
    const moscow = (day: string, h: number) =>
      new Date(`${day}T${String(h).padStart(2, '0')}:00:00+03:00`);
    expect(shouldSendDigest(moscow('2026-10-26', 8), 1, 9)).toBe(false);
    expect(shouldSendDigest(moscow('2026-10-26', 9), 1, 9)).toBe(true);
    expect(shouldSendDigest(moscow('2026-10-27', 10), 1, 9)).toBe(false);
    // 07:00 UTC в понедельник это уже 10:00 по Москве: пояс контейнера не важен.
    expect(shouldSendDigest(new Date('2026-10-26T07:00:00Z'), 1, 9)).toBe(true);
  });
});
