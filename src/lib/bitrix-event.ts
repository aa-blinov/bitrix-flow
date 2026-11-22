// Поля задачи из события портала. На удаление он шлёт FIELDS_AFTER строкой «undefined»:
// строка непустая, и разбор по «||» брал её вместо объекта, теряя номер задачи.
export function eventFields(raw: unknown): Record<string, any> {
  const object = (value: unknown) =>
    value && typeof value === 'object' ? (value as Record<string, any>) : null;
  const data = raw as Record<string, unknown> | undefined;
  return (
    object(data?.FIELDS_AFTER) ||
    object(data?.fieldsAfter) ||
    object(data?.FIELDS_BEFORE) ||
    object(data?.fieldsBefore) ||
    object(raw) ||
    {}
  );
}
