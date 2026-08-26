// MongoDB init script - создает пользователя с правами на bitrix_kanban
db = db.getSiblingDB('bitrix_kanban');
db.createUser({
  user: 'kanban',
  pwd: 'kanban2026',
  roles: [{ role: 'readWrite', db: 'bitrix_kanban' }],
});
