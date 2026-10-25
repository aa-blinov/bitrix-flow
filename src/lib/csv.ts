// CSV для Excel: разделитель «;» (так открывается в русской локали), BOM, чтобы не
// было кракозябр, и защита от формул. Названия задач и проектов приходят от людей из
// Битрикса: ячейка «=HYPERLINK(...)» в Excel выполнилась бы как формула, поэтому текст,
// начинающийся с = + - @, получает апостроф. Числа пишутся как есть: «-5» это число.
const FORMULA = /^[=+\-@\t\r]/;

export function csvCell(value: unknown): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  let text = String(value ?? '').replace(/[\r\n]+/g, ' ');
  if (FORMULA.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function toCsv(rows: unknown[][]): string {
  return '﻿' + rows.map((row) => row.map(csvCell).join(';')).join('\r\n');
}

export function downloadCsv(filename: string, rows: unknown[][]) {
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
