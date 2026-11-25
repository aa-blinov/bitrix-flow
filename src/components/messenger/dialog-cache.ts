import type { Dialog } from '@/lib/messenger';

/**
 * Список чатов, который виден сразу при входе в «Сообщения»: с прошлого захода или
 * загруженный заранее, пока человек работал на другом экране. Свежий приходит следом
 * опросом. Без него каждый вход начинался с полсекунды пустой колонки: список отдаёт портал.
 * Живёт только в браузере: на сервере модуль не наполняется и не делится между людьми.
 */
export type DialogList = { dialogs: Dialog[]; me: number; portal: string };

let last: DialogList | null = null;
let primed = false;

export const lastDialogs = () => last;

export function rememberDialogs(list: DialogList) {
  last = list;
}

/** Один раз за сессию вкладки, когда браузер свободен. */
export function primeDialogs() {
  if (primed || last) return;
  primed = true;
  void fetch('/api/messenger/dialogs?offset=0&me=0')
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (last || !Array.isArray(data?.dialogs)) return;
      last = { dialogs: data.dialogs, me: Number(data.me) || 0, portal: String(data.portal || '') };
    })
    .catch(() => {});
}
