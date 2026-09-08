// Единый вид панели над списком задач и над доской: до этого грид рисовал
// контролы с rounded-md и мелким шрифтом, а канбан — с rounded-lg и обычным,
// из-за чего две страницы выглядели собранными из разных наборов.
export const toolbarControl = 'h-8 rounded-md';

export const toolbarSelect = 'h-8 w-40 rounded-md';

export const toolbarPanel =
  'flex w-full flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2.5';
