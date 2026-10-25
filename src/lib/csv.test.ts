import { describe, expect, it } from 'vitest';
import { csvCell, toCsv } from './csv';

describe('csv', () => {
  it('quotes cells, doubles quotes and flattens line breaks', () => {
    expect(csvCell('Сказал "привет"\nвсем')).toBe('"Сказал ""привет"" всем"');
    expect(csvCell(undefined)).toBe('""');
  });

  it('defuses spreadsheet formulas in text but leaves numbers alone', () => {
    expect(csvCell('=HYPERLINK("http://evil","x")')).toBe(`"'=HYPERLINK(""http://evil"",""x"")"`);
    expect(csvCell('+7 999')).toBe(`"'+7 999"`);
    expect(csvCell('-итого')).toBe(`"'-итого"`);
    expect(csvCell('@user')).toBe(`"'@user"`);
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell(12.5)).toBe('12.5');
  });

  it('starts with a BOM and separates by semicolons and CRLF', () => {
    expect(
      toCsv([
        ['a', 1],
        ['b', 2],
      ]),
    ).toBe('﻿"a";1\r\n"b";2');
  });
});
