/**
 * Открытая карточка живёт в адресе (?task=id), чтобы её можно было переслать и закрыть
 * кнопкой «назад». Адрес меняем нативным pushState, а не router.push: Next встраивает его в
 * роутер (useSearchParams обновляется), но не ходит за страницей на сервер. С router.push
 * карточка из списка открывалась только после этого запроса.
 */
export function setTaskInUrl(taskId: string | null) {
  const params = new URLSearchParams(window.location.search);
  if (taskId) params.set('task', taskId);
  else params.delete('task');
  const query = params.toString();
  window.history.pushState(null, '', query ? `?${query}` : window.location.pathname);
}
