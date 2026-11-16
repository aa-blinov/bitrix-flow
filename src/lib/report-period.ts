// Период из запроса: настоящая календарная дата, а не только форма ГГГГ-ММ-ДД. 2026-99-99
// проходил регулярку и ронял расчёт недель, пользователь видел «Не удалось построить отчёт».
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isDay(value: string) {
  if (!DAY.test(value)) return false;
  const moment = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(moment.getTime()) && moment.toISOString().slice(0, 10) === value;
}

export const validPeriod = (from: string, to: string) => isDay(from) && isDay(to) && from <= to;
