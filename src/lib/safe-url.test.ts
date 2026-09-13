import { describe, expect, it } from 'vitest';
import { safeHref, safeImageSrc } from './safe-url';

describe('safeHref', () => {
  it('пропускает обычные ссылки', () => {
    expect(safeHref('https://example.com/a')).toBe('https://example.com/a');
    expect(safeHref('mailto:a@b.c')).toBe('mailto:a@b.c');
    expect(safeHref('/tasks/1')).toBe('/tasks/1');
  });

  it('отбрасывает исполняемые схемы, в том числе с обходами', () => {
    expect(safeHref('javascript:alert(1)')).toBeUndefined();
    expect(safeHref('  JavaScript:alert(1)')).toBeUndefined();
    expect(safeHref('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeHref('vbscript:msgbox(1)')).toBeUndefined();
  });
});

describe('safeImageSrc', () => {
  it('разрешает сеть и картинки в data', () => {
    expect(safeImageSrc('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(safeImageSrc('data:image/png;base64,AAA')).toBe('data:image/png;base64,AAA');
  });

  it('не даёт подсунуть html или скрипт', () => {
    expect(safeImageSrc('data:text/html,<script>alert(1)</script>')).toBeUndefined();
    expect(safeImageSrc('javascript:alert(1)')).toBeUndefined();
  });
});
