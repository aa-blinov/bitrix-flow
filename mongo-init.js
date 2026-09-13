// Пользователь приложения: только readWrite на рабочей базе, без прав
// администратора. Пароль приходит из окружения — в репозитории его нет.
const user = process.env.MONGO_APP_USERNAME;
const pwd = process.env.MONGO_APP_PASSWORD;
if (!user || !pwd) {
  throw new Error('MONGO_APP_USERNAME и MONGO_APP_PASSWORD обязательны');
}
db = db.getSiblingDB('bitrix_kanban');
db.createUser({ user, pwd, roles: [{ role: 'readWrite', db: 'bitrix_kanban' }] });
