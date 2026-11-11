// Потоки UI-тестов. У каждого свой сервер и своя база: тесты меняют данные (теги,
// учётки, сообщения), и на общей базе два потока ломали бы друг другу проверки.
// Больше двух потоков машина не тянет: каждый это сервер Next и браузер.
export const UI_WORKERS = Math.max(1, Number(process.env.UI_WORKERS) || 2);

export const serverPort = (index: number) => 3111 + index;
export const serverUrl = (index: number) => `http://127.0.0.1:${serverPort(index)}`;
// Имя нулевой базы прежнее, чтобы одиночный прогон и старые команды работали как раньше.
// То же правило повторено в scripts/seed-test-db.mjs.
export const dbName = (index: number) =>
  index ? `bitrix_kanban_test_${index}` : 'bitrix_kanban_test';
export const statePath = (index: number) => `tests/.auth/state-${index}.json`;
