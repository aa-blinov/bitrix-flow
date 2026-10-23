import { describe, expect, it } from 'vitest';

import { bitrixErrorMessage, getPayload } from './bitrix-payload';

describe('тело запроса к Bitrix24', () => {
  it('результат задачи адресуется полем id: REST v3 не знает resultId', () => {
    expect(getPayload('tasks.task.result.delete', { resultId: '1555' })).toEqual({ id: 1555 });
    expect(getPayload('tasks.task.result.update', { resultId: '1555', text: 'новый' })).toEqual({
      id: 1555,
      fields: { text: 'новый' },
    });
  });

  it('создание результата передаёт задачу и текст в fields', () => {
    expect(getPayload('tasks.task.result.add', { taskId: '5433', text: 'сделано' })).toEqual({
      fields: { taskId: 5433, text: 'сделано' },
    });
  });

  it('поля задачи распаковываются из JSON-строки', () => {
    expect(
      getPayload('tasks.task.update', {
        taskId: '1',
        fields: JSON.stringify({ TITLE: 'Новое название' }),
      }),
    ).toEqual({ taskId: '1', fields: { TITLE: 'Новое название' } });
  });

  it('запись времени: идентификаторы становятся числами', () => {
    expect(
      getPayload('task.elapseditem.update', {
        TASKID: '5471',
        ELAPSEDITEMID: '8647',
        'fields[SECONDS]': '3600',
        'fields[COMMENT_TEXT]': 'Работа',
      }),
    ).toEqual({
      TASKID: 5471,
      ELAPSEDITEMID: 8647,
      fields: { SECONDS: '3600', COMMENT_TEXT: 'Работа' },
    });
  });

  it('удаление записи времени: только идентификаторы', () => {
    expect(
      getPayload('task.elapseditem.delete', { TASKID: '5471', ELAPSEDITEMID: '8647' }),
    ).toEqual({ TASKID: 5471, ELAPSEDITEMID: 8647 });
  });

  it('пункт чек-листа: идентификаторы становятся числами', () => {
    expect(
      getPayload('task.checklistitem.update', {
        TASKID: '5471',
        ITEMID: '1393',
        'fields[TITLE]': 'Новое название',
      }),
    ).toEqual({ TASKID: 5471, ITEMID: 1393, fields: { TITLE: 'Новое название' } });
  });

  it('вложенные фильтры списка собираются в объекты', () => {
    expect(
      getPayload('tasks.task.list', {
        'filter[GROUP_ID]': '1',
        'select[0]': '*',
        start: '0',
      }),
    ).toEqual({ filter: { GROUP_ID: '1' }, select: ['*'], start: '0' });
  });
});

describe('сообщение об ошибке Bitrix24', () => {
  it('в REST v2 берёт error_description', () => {
    expect(
      bitrixErrorMessage({ error: '22002', error_description: 'Internal server error.' }),
    ).toBe('22002: Internal server error.');
  });

  it('в REST v3 берёт message из объекта ошибки', () => {
    expect(
      bitrixErrorMessage({
        error: { code: 'BITRIX_REST_V3_EXCEPTION', message: 'Невалидный JSON' },
      }),
    ).toBe('Невалидный JSON');
  });

  it('в REST v3 показывает детали валидации', () => {
    const message = bitrixErrorMessage({
      error: {
        code: 'VALIDATION',
        message: 'Ошибка при валидации объекта запроса',
        validation: [{ message: 'Не заполнено значение id' }],
      },
    });
    expect(message).toContain('Ошибка при валидации объекта запроса');
    expect(message).toContain('Не заполнено значение id');
  });

  it('никогда не показывает «[object Object]»', () => {
    expect(bitrixErrorMessage({ error: { code: 'X' } })).not.toContain('[object Object]');
    expect(bitrixErrorMessage({ error: { message: 'Понятная причина' } })).toBe('Понятная причина');
  });
});
