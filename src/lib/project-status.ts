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

// Списки REST создают свойства с системными кодами PROPERTY_<id>: назвать
// поле своими кодом нельзя. Карта строится по названию поля — она же даёт
// коды для записи.
export type StatusFieldMap = Record<string, string>; // название поля -> FIELD_ID

export const FIELD_LABELS = {
  client: 'Клиент',
  status: 'Статус',
  goal: 'Цель',
  state: 'Текущее состояние',
  step: 'Ближайший шаг',
  stepDeadline: 'Срок шага',
  risk: 'Главный риск',
  owner: 'Ответственный сейчас',
  project: 'ID проекта',
} as const;

export async function buildFieldMap(
  call: (method: string, params: Record<string, unknown>) => Promise<any>,
): Promise<StatusFieldMap> {
  const fields = await call('lists.field.get', {
    IBLOCK_TYPE_ID: STATUS_LIST_TYPE_ID,
  });
  const map: StatusFieldMap = {};
  for (const field of Object.values(fields || {}) as any[]) {
    if (field?.NAME && field?.FIELD_ID && !map[field.NAME]) map[field.NAME] = field.FIELD_ID;
  }
  return map;
}

// Строку 15.11.2026 и прочие локальные форматы Битрикса приводим к ISO:
// фронт не должен зависеть от настроек портала.
export function toIsoDate(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  const match = raw.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
  if (!match) return '';
  return new Date(`${match[3]}-${match[2]}-${match[1]}T00:00:00.000Z`).toISOString();
}

// Значение свойства приходит вложенным ({<id>: value}) или плоским.
function propertyValue(fields: Record<string, unknown>, fieldId: string): string {
  if (!fieldId) return '';
  const raw = fields[fieldId];
  if (raw === undefined || raw === null) return '';
  if (typeof raw === 'object') {
    const own = Object.values(raw as Record<string, unknown>)[0];
    return own === undefined || own === null ? '' : String(own);
  }
  return String(raw);
}

export function mapStatusElement(
  element: Record<string, unknown>,
  map: StatusFieldMap,
): ProjectStatus | null {
  const fields = (element.fields || element.FIELDS || element) as Record<string, unknown>;
  const projectId =
    propertyValue(fields, map[FIELD_LABELS.project]) || String(fields.NAME ?? '').trim();
  if (!projectId || projectId === '0' || projectId === 'unknown') return null;
  return {
    projectId,
    client: propertyValue(fields, map[FIELD_LABELS.client]),
    status: propertyValue(fields, map[FIELD_LABELS.status]),
    goal: propertyValue(fields, map[FIELD_LABELS.goal]),
    state: propertyValue(fields, map[FIELD_LABELS.state]),
    step: propertyValue(fields, map[FIELD_LABELS.step]),
    stepDeadline: toIsoDate(propertyValue(fields, map[FIELD_LABELS.stepDeadline])),
    risk: propertyValue(fields, map[FIELD_LABELS.risk]),
    ownerId: propertyValue(fields, map[FIELD_LABELS.owner]),
    updatedAt: new Date().toISOString(),
  };
}

// Элемент списка адресуем стабильным кодом: повторное редактирование не должно
// создавать вторую запись по проекту.
export function elementCode(projectId: string) {
  return `project-${projectId}`;
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

// Ключ формы — что вводит пользователь. Валидация отсекает неизвестные статусы
// и слишком длинные тексты: отказ лучше ловить до запроса в портал.
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

// Формат даты для списков REST — дд.мм.гггг.
function toPortalDate(iso: string) {
  return iso ? iso.slice(0, 10).split('-').reverse().join('.') : '';
}

export function elementFields(values: StatusPayload, map: StatusFieldMap) {
  return {
    NAME: values.projectId,
    [map[FIELD_LABELS.project]]: values.projectId,
    [map[FIELD_LABELS.client]]: values.client,
    [map[FIELD_LABELS.status]]: values.status,
    [map[FIELD_LABELS.goal]]: values.goal,
    [map[FIELD_LABELS.state]]: values.state,
    [map[FIELD_LABELS.step]]: values.step,
    [map[FIELD_LABELS.stepDeadline]]: toPortalDate(values.stepDeadline),
    [map[FIELD_LABELS.risk]]: values.risk,
    [map[FIELD_LABELS.owner]]: values.ownerId,
  };
}

// Список и поля создаются один раз за жизнь процесса: у установленного
// приложения список уже может быть создан руками, лишних вызовов не делаем.
let listEnsured = false;

type BitrixCall = (method: string, params: Record<string, unknown>) => Promise<any>;

// Статусы списков REST: TYPE 'S' строка, 'N' число. USER_TYPE порталом на этой
// установке игнорируется (возвращает false), поэтому дата и ответственный —
// тоже строки: приложение приводить форматы само.
const FIELD_DEFS = [
  { code: 'CLIENT', type: 'S', name: FIELD_LABELS.client },
  { code: 'STATUS', type: 'S', name: FIELD_LABELS.status },
  { code: 'GOAL', type: 'S', name: FIELD_LABELS.goal, rows: true },
  { code: 'STATE', type: 'S', name: FIELD_LABELS.state, rows: true },
  { code: 'STEP', type: 'S', name: FIELD_LABELS.step, rows: true },
  { code: 'STEP_DEADLINE', type: 'S', name: FIELD_LABELS.stepDeadline },
  { code: 'RISK', type: 'S', name: FIELD_LABELS.risk, rows: true },
  { code: 'OWNER', type: 'S', name: FIELD_LABELS.owner },
  { code: 'PROJECT_ID', type: 'N', name: FIELD_LABELS.project },
];

async function ensureFields(
  call: BitrixCall,
  typeParams: Record<string, unknown>,
  iblockId: string,
): Promise<void> {
  const existing = await call('lists.field.get', { ...typeParams, IBLOCK_ID: iblockId });
  const byName = new Map<string, string>();
  for (const field of Object.values(existing || {}) as any[]) {
    if (field?.NAME) byName.set(String(field.NAME), String(field.FIELD_ID));
  }
  for (const def of FIELD_DEFS) {
    if (byName.has(def.name)) continue;
    try {
      // ERROR_SAVE_FIELD в ответе — ложная тревога этой установки: свойство
      // при этом сохраняется. Проверяем не по ответу, а по фактическому
      // набору полей на следующем чтении.
      await call('lists.field.add', {
        ...typeParams,
        IBLOCK_ID: iblockId,
        FIELDS: {
          NAME: def.name,
          FIELD_NAME: def.code,
          TYPE: def.type,
          IS_REQUIRED: 'N',
          LIST_COLUMN_SHOW: 'Y',
          ...(def.rows ? { SETTINGS: { ROW_COUNT: 3, COL_COUNT: 40 } } : {}),
        },
      });
    } catch (error) {
      console.warn(`[project-status] поле ${def.code} не создалось:`, error);
    }
  }
}

export async function ensureStatusList(call: BitrixCall): Promise<void> {
  if (listEnsured) return;
  try {
    const typeParams = { IBLOCK_TYPE_ID: STATUS_LIST_TYPE_ID };
    const lists = await call('lists.get', typeParams);
    // У списков REST ключ кода — CODE, на старых порталах встречается IBLOCK_CODE.
    const known = (lists || []).find(
      (item: any) => item?.CODE === STATUS_LIST_CODE || item?.IBLOCK_CODE === STATUS_LIST_CODE,
    );
    let iblockId = known?.ID || known?.IBLOCK_ID;
    if (!iblockId) {
      // Название списка передаётся внутри FIELDS: на верхнем уровне портал
      // отвечает «Required parameter NAME is missing».
      await call('lists.add', {
        ...typeParams,
        IBLOCK_CODE: STATUS_LIST_CODE,
        FIELDS: { NAME: STATUS_LIST_TITLE },
      });
      const created = await call('lists.get', typeParams);
      const found = (created || []).find(
        (item: any) => item?.CODE === STATUS_LIST_CODE || item?.IBLOCK_CODE === STATUS_LIST_CODE,
      );
      iblockId = found?.ID || found?.IBLOCK_ID;
    }
    if (iblockId) await ensureFields(call, typeParams, String(iblockId));
    listEnsured = true;
  } catch (error) {
    console.warn('[project-status] список статусов не создался:', error);
    listEnsured = true;
  }
}
