// Статусы проектов: одна запись на проект Битрикса хранится в универсальном
// списке портала (lists), приложение зеркалит её в MongoDB и рисует на сводке.
// Битрикс — источник правды: правки через REST идут в lists.element, зеркало
// нужно только чтобы списки читались из MongoDB, а не ходили в портал.

export const STATUS_LIST_CODE = 'project_status';
export const STATUS_LIST_TITLE = 'Статусы проектов';
export const STATUS_LIST_TYPE_ID = 'lists';

export const STATUS_OPTIONS = [
  'В работе',
  'Ждёт договора',
  'Не оформлен',
  'Под угрозой',
  'Готово',
] as const;

export type ProjectStatus = {
  projectId: string;
  client: string;
  status: string;
  goal: string;
  state: string;
  step: string;
  stepDeadline: string;
  risk: string;
  ownerId: string;
  updatedAt: string;
};

// Коды свойств списка: создавать их можно и руками в портале — коды ниже
// связаны с добавлением полей в ensureStatusList.
const PROPERTY_CODES = {
  client: 'PROPERTY_CLIENT',
  status: 'PROPERTY_STATUS',
  goal: 'PROPERTY_GOAL',
  state: 'PROPERTY_STATE',
  step: 'PROPERTY_STEP',
  stepDeadline: 'PROPERTY_STEP_DEADLINE',
  risk: 'PROPERTY_RISK',
  owner: 'PROPERTY_OWNER',
  project: 'PROPERTY_PROJECT_ID',
} as const;

// Битрикс возвращает даты как 'дд.мм.гггг' — приводим к ISO, чтобы фронт
// не зависел от локали портала.
function toIsoDate(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  // Ожидаемый формат Битрикса, но на всякий случай парсим вручную.
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return '';
  return new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`).toISOString();
}

export function mapStatusElement(element: Record<string, unknown>): ProjectStatus | null {
  const fields = (element.fields || element.FIELDS || element) as Record<string, unknown>;
  const projectId = String(fields[PROPERTY_CODES.project] ?? fields.PROJECT_ID ?? '').trim();
  if (!projectId || projectId === '0') return null;
  return {
    projectId,
    client: String(fields[PROPERTY_CODES.client] ?? '').trim(),
    status: String(fields[PROPERTY_CODES.status] ?? '').trim(),
    goal: String(fields[PROPERTY_CODES.goal] ?? '').trim(),
    state: String(fields[PROPERTY_CODES.state] ?? '').trim(),
    step: String(fields[PROPERTY_CODES.step] ?? '').trim(),
    stepDeadline: toIsoDate(fields[PROPERTY_CODES.stepDeadline]),
    risk: String(fields[PROPERTY_CODES.risk] ?? '').trim(),
    ownerId: String(fields[PROPERTY_CODES.owner] ?? '').trim(),
    updatedAt: new Date().toISOString(),
  };
}

// Элемент списка адресуем стабильным кодом: повторное редактирование не должно
// создавать вторую запись по проекту.
export function elementCode(projectId: string) {
  return `project-${projectId}`;
}

// Ключ формы — что вводит пользователь. Валидация отсекает неизвестные статусы
// и слишком длинные тексты: REST портала про них рассказывает подробно, но
// отказ лучше ловить до запроса.
export function validateStatusPayload(input: unknown): StatusPayload {
  if (typeof input !== 'object' || input === null) throw new Error('VALIDATION_FAILED');
  const body = input as Record<string, unknown>;
  const projectId = String(body.projectId || '').trim();
  if (!/^\d+$/.test(projectId)) throw new Error('VALIDATION_FAILED');
  const text = (key: string, max: number) => {
    const raw = String(body[key] ?? '').trim();
    return raw.length > max ? '' : raw;
  };
  const status = text('status', 100);
  return {
    projectId,
    client: text('client', 200),
    status: (STATUS_OPTIONS as readonly string[]).includes(status) ? status : '',
    goal: text('goal', 10_000),
    state: text('state', 10_000),
    step: text('step', 2_000),
    stepDeadline: toIsoDate(body.stepDeadline),
    risk: text('risk', 10_000),
    ownerId: text('ownerId', 32).replace(/\D/g, ''),
  };
}

export type StatusPayload = {
  projectId: string;
  client: string;
  status: string;
  goal: string;
  state: string;
  step: string;
  stepDeadline: string;
  risk: string;
  ownerId: string;
};

// Формат даты для списков REST — дд.мм.гггг.
function toPortalDate(iso: string) {
  return iso ? iso.slice(0, 10).split('-').reverse().join('.') : '';
}

export function elementFields(values: StatusPayload) {
  return {
    NAME: values.projectId,
    [PROPERTY_CODES.project]: values.projectId,
    [PROPERTY_CODES.client]: values.client,
    [PROPERTY_CODES.status]: values.status,
    [PROPERTY_CODES.goal]: values.goal,
    [PROPERTY_CODES.state]: values.state,
    [PROPERTY_CODES.step]: values.step,
    [PROPERTY_CODES.stepDeadline]: toPortalDate(values.stepDeadline),
    [PROPERTY_CODES.risk]: values.risk,
    [PROPERTY_CODES.owner]: values.ownerId,
  };
}

// Список и поля создаются один раз за жизнь процесса: у установленного
// приложения список может быть уже создан руками, лишних вызовов не делаем.
let listEnsured = false;

type BitrixCall = (method: string, params: Record<string, unknown>) => Promise<any>;

const enumListValues = (code: string) =>
  code === PROPERTY_CODES.status ? STATUS_OPTIONS.map((option) => ({ VALUE: option })) : [];

const FIELD_DEFS = [
  [PROPERTY_CODES.client, 'string', 'Клиент'],
  [PROPERTY_CODES.status, 'L', 'Статус'],
  [PROPERTY_CODES.goal, 'text', 'Цель'],
  [PROPERTY_CODES.state, 'text', 'Текущее состояние'],
  [PROPERTY_CODES.step, 'text', 'Ближайший шаг'],
  [PROPERTY_CODES.stepDeadline, 'date', 'Срок шага'],
  [PROPERTY_CODES.risk, 'text', 'Главный риск'],
  [PROPERTY_CODES.owner, 'S:UserID', 'Ответственный сейчас'],
  [PROPERTY_CODES.project, 'string', 'ID проекта'],
].map(([code, userType, title]) => ({
  code,
  userType,
  title,
  list:
    userType === 'L'
      ? enumListValues(code).map((item, index) => ({ ...item, SORT: String((index + 1) * 100) }))
      : undefined,
}));

export async function ensureStatusList(call: BitrixCall): Promise<void> {
  if (listEnsured) return;
  try {
    const lists = await call('lists.get', { IBLOCK_TYPE_ID: STATUS_LIST_TYPE_ID });
    const known = (lists || []).find(
      (item: any) => item?.IBLOCK_CODE === STATUS_LIST_CODE || item?.CODE === STATUS_LIST_CODE,
    );
    let iblockId = known?.ID || known?.IBLOCK_ID;
    if (!iblockId) {
      await call('lists.add', {
        IBLOCK_TYPE_ID: STATUS_LIST_TYPE_ID,
        IBLOCK_CODE: STATUS_LIST_CODE,
        IBLOCK_TITLE: STATUS_LIST_TITLE,
      });
      const created = await call('lists.get', { IBLOCK_TYPE_ID: STATUS_LIST_TYPE_ID });
      const found = (created || []).find(
        (item: any) => item?.IBLOCK_CODE === STATUS_LIST_CODE || item?.CODE === STATUS_LIST_CODE,
      );
      iblockId = found?.ID || found?.IBLOCK_ID;
    }
    if (iblockId) {
      const existing = await call('lists.field.get', { IBLOCK_ID: String(iblockId) });
      const have = new Set(Object.keys(existing || {}).map((code) => code.toUpperCase()));
      for (const field of FIELD_DEFS) {
        if (have.has(field.code.toUpperCase())) continue;
        try {
          await call('lists.field.add', {
            IBLOCK_ID: String(iblockId),
            FIELDS: {
              FIELD_NAME: field.code,
              USER_TYPE: field.userType,
              EDIT_FORM_LABEL: field.title,
              LIST_COLUMN_SHOW: 'Y',
              ...(field.list ? { LIST: field.list } : {}),
            },
          });
        } catch (error) {
          // Поле могло быть создано руками с другим типом: чтению это не мешает,
          // а дублировать попытки в каждом запросе смысла нет.
          console.warn(`[project-status] поле ${field.code} не создалось:`, error);
        }
      }
    }
    listEnsured = true;
  } catch (error) {
    console.warn('[project-status] список статусов не создался:', error);
    listEnsured = true;
  }
}
