// Единый вид панели над списком задач и над доской: до этого грид рисовал
// контролы с rounded-md и мелким шрифтом, а канбан — с rounded-lg и обычным,
// из-за чего две страницы выглядели собранными из разных наборов.
// На телефоне контролы выше: 32px — это ниже комфортной зоны пальца (~44px),
// на мыши лишняя высота ни к чему, поэтому сжимаем их с sm.
export const toolbarControl = 'h-10 rounded-md sm:h-8';

export const toolbarSelect = 'h-10 w-40 rounded-md sm:h-8';

export const toolbarPanel =
  'flex w-full flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2.5';
