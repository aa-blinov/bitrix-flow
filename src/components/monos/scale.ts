/**
 * Единая шкала кегля и отступов для интерфейса. Классы держит один модуль:
 * раньше заголовок страницы, диалоги и секции тянули свои размеры, и на
 * переходах между экранами шапки «прыгали».
 */
export const FONT = {
  // Диалоги и их заголовки — на ступень ниже заголовка страницы.
  pageTitle: 'text-xl font-bold tracking-tight text-ink',
  dialogTitle: 'text-lg font-bold tracking-tight text-ink',
  sectionTitle: 'text-xl font-bold tracking-tight text-ink',
  body: 'text-sm text-ink-soft',
  dense: 'text-xs text-ink-soft',
  // Числовые плитки: одна кегль-ступень на весь продукт; акцентные виджеты
  // дашбордов — на ступень крупнее, но с той же гарнитурой и tabular-цифрами.
  metric: 'text-2xl font-semibold tabular-nums text-ink',
  metricLarge: 'text-3xl font-semibold tabular-nums text-ink',
} as const;

export const PAD = {
  // Шапка страницы: узкие боковые отступы на телефоне — и вдвое больше на десктопе.
  page: 'px-4 py-4 lg:px-6',
  // Панели и диалоги живут на одной внутренней сетке (24px, на sm — 32px).
  dialog: 'p-6 sm:p-8',
  panel: 'p-4',
  card: 'p-3',
} as const;
