// Тело запросов к Bitrix24 и разбор ошибок REST v2/v3.
//
// Методы из REST_V3_METHODS ждут JSON, и у них другой набор полей: результат
// задачи адресуется полем id, а не resultId. С resultId портал отвечал ошибкой
// валидации, и правка и удаление результата не работали.

export function getPayload(
  method: string,
  params: Record<string, string>,
): Record<string, unknown> {
  if (method === 'tasks.task.chat.message.send') {
    return { fields: { taskId: Number(params.taskId), text: params.text } };
  }

  // Правка и удаление записи времени: портал ждёт целые числа в
  // идентификаторах («expected to be of type integer»), поэтому тело собираем
  // руками, а не строкой из query-параметров.
  if (method === 'task.elapseditem.update' || method === 'task.elapseditem.delete') {
    const payload: Record<string, unknown> = { TASKID: Number(params.TASKID) };
    if (params.ELAPSEDITEMID) payload.ELAPSEDITEMID = Number(params.ELAPSEDITEMID);
    if (method === 'task.elapseditem.update') {
      const fields: Record<string, unknown> = {};
      const seconds = params['fields[SECONDS]'] ?? params['FIELDS[SECONDS]'];
      const comment = params['fields[COMMENT_TEXT]'] ?? params['FIELDS[COMMENT_TEXT]'];
      if (seconds !== undefined) fields.SECONDS = seconds;
      if (comment !== undefined) fields.COMMENT_TEXT = comment;
      payload.fields = fields;
    }
    return payload;
  }

  // То же с пунктом чек-листа: идентификаторы — числа.
  if (method === 'task.checklistitem.update') {
    return {
      TASKID: Number(params.TASKID),
      ITEMID: Number(params.ITEMID),
      fields: { TITLE: params['fields[TITLE]'] ?? params['FIELDS[TITLE]'] },
    };
  }

  if (method === 'tasks.task.result.add') {
    return { fields: { taskId: Number(params.taskId), text: params.text } };
  }
  if (method === 'tasks.task.result.update') {
    return { id: Number(params.resultId), fields: { text: params.text } };
  }
  if (method === 'tasks.task.result.delete') {
    return { id: Number(params.resultId) };
  }

  if (method === 'tasks.task.add' || method === 'tasks.task.update') {
    const payload: Record<string, unknown> = { ...params };
    if (typeof params.fields === 'string') {
      try {
        payload.fields = JSON.parse(params.fields);
      } catch {
        // Пусть сам Битрикс вернёт ошибку валидации на некорректный ввод.
      }
    }
    return payload;
  }

  if (method !== 'tasks.task.list') return params;

  const payload: Record<string, any> = {};
  for (const [key, value] of Object.entries(params)) {
    const nested = key.match(/^(filter|order|select)\[([^\]]+)\]$/);
    if (!nested) {
      payload[key] = value;
      continue;
    }
    const [, field, childKey] = nested;
    if (field === 'select') {
      payload.select ||= [];
      payload.select[Number(childKey)] = value;
    } else {
      payload[field] ||= {};
      payload[field][childKey] = value;
    }
  }
  return payload;
}

// В REST v3 ошибка приходит объектом {code, message, validation}, в v2 —
// строкой с error_description. Пользователю нужна причина отказа, а не
// «[object Object]: undefined».
export function bitrixErrorMessage(data: any): string {
  const error = data?.error;
  if (error && typeof error === 'object') {
    const message = error.message || error.error_description || error.code || 'Ошибка Bitrix24';
    const details = Array.isArray(error.validation)
      ? error.validation
          .map((item: any) => item?.message)
          .filter(Boolean)
          .join('; ')
      : '';
    return details ? `${message}: ${details}` : String(message);
  }
  return `${error}: ${data?.error_description ?? ''}`.replace(/:\s*$/, '').trim();
}
