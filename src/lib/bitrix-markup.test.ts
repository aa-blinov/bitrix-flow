import { describe, expect, it } from 'vitest';
import { formatBitrixDateTime, parseBitrixMarkup } from './bitrix-markup';

describe('Bitrix markup', () => {
  it('turns URL BBCode into a safe link', () => {
    expect(parseBitrixMarkup('Открыть [url]https://example.com/a[/url]')).toEqual([
      { text: 'Открыть ' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
    ]);
    expect(parseBitrixMarkup('[url=javascript:alert(1)]ссылка[/url]')).toEqual([{ text: 'ссылка' }]);
  });

  it('uses HH:MM DD.MM.YYYY dates', () => {
    expect(formatBitrixDateTime('2025-12-31T14:05:00+03:00')).toMatch(/^\d{2}:\d{2} 31\.12\.2025$/);
  });
});
