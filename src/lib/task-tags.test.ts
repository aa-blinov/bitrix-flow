import { describe, expect, it } from 'vitest';
import { extractTaskTags } from './task-tags';

describe('extractTaskTags', () => {
  it('extracts unique Cyrillic and Latin hashtags from task text', () => {
    expect(
      extractTaskTags('Подготовить #Release_2026', 'Обсудить #маркетинг и #release_2026'),
    ).toEqual(['#Release_2026', '#маркетинг']);
  });

  it('does not mistake URL fragments for a tag', () => {
    expect(extractTaskTags('', 'https://example.com/page#section #реальный-тег')).toEqual([
      '#реальный-тег',
    ]);
  });
});
