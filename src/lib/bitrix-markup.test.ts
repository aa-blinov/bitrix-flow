import { describe, expect, it } from 'vitest';
import { formatBitrixDateTime, parseBitrixMarkup } from './bitrix-markup';

describe('Bitrix markup', () => {
  it('turns URL BBCode into a safe link', () => {
    expect(parseBitrixMarkup('Открыть [url]https://example.com/a[/url]')).toEqual([
      { text: 'Открыть ' },
      { text: 'https://example.com/a', href: 'https://example.com/a' },
    ]);
    expect(parseBitrixMarkup('[url=javascript:alert(1)]ссылка[/url]')).toEqual([{ text: 'ссылка' }]);
    expect(parseBitrixMarkup('[USER=1]Сергей Веренцов[/USER]')).toEqual([
      { text: 'Сергей Веренцов', href: 'https://eora.bitrix24.ru/company/personal/user/1/' },
    ]);
  });

  it('renders Bitrix timestamp BBCode', () => {
    const text = parseBitrixMarkup('[TIMESTAMP=1784725200 FORMAT=LONG_DATE_FORMAT], [TIMESTAMP=1784725200 FORMAT=SHORT_TIME_FORMAT]').map((part) => part.text).join('');
    expect(text).not.toContain('TIMESTAMP');
    expect(text).toContain('2026');
    expect(text).toMatch(/\d{2}:\d{2}/);
  });

  it('uses HH:MM DD.MM.YYYY dates', () => {
    expect(formatBitrixDateTime('2025-12-31T14:05:00+03:00')).toMatch(/^\d{2}:\d{2} 31\.12\.2025$/);
  });
});
