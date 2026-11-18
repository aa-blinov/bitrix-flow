import { NextRequest, NextResponse } from 'next/server';
import { getDb } from '@/lib/mongo';
import { isMockEnabled } from '@/lib/mock-b24';
import { postBitrixJson } from '@/lib/bitrix-request';
import { getAuthorizedMemberId } from '@/lib/authorized-member';
import { sessionCookie } from '@/lib/session';
type TokenRef = { access_token: string; domain: string };

import {
  STATUS_LIST_CODE,
  STATUS_LIST_TYPE_ID,
  buildFieldMap,
  ensureStatusList,
  elementCode,
  elementFields,
  mapStatusElement,
  validateStatusPayload,
  type ProjectStatus,
  type StatusFieldMap,
} from '@/lib/project-status';

// Один агрегированный запрос на открытие сводки: списки REST отдают все
// элементы разом, отдельного запроса на проект здесь нет — иначе открытие
// страницы превратится в десятки вызовов портала.
async function listElements(token: TokenRef, method: string, params: Record<string, unknown>) {
  const url = `https://${token.domain}/rest/${method}?auth=${token.access_token}`;
  const response = await postBitrixJson(url, params, true);
  if (response.error) throw new Error(`${response.error}: ${response.error_description}`);
  return response.result;
}

// Адресация элемента по IBLOCK_ID: lists.element.get принимает его или код
// списка, но поиск по коду надёжнее — ID свежесозданного списка не кешируем.
async function findIblock(
  token: TokenRef,
): Promise<{ id: string; fieldMap: StatusFieldMap } | null> {
  const lists = await listElements(token, 'lists.get', { IBLOCK_TYPE_ID: STATUS_LIST_TYPE_ID });
  // У списков REST ключ кода — CODE, на старых порталах встречается IBLOCK_CODE.
  const list = (lists || []).find(
    (item: any) => item?.IBLOCK_CODE === STATUS_LIST_CODE || item?.CODE === STATUS_LIST_CODE,
  );
  if (!list) return null;
  const iblockId = String(list.ID || list.IBLOCK_ID || '');
  const fieldMap = await buildFieldMap((method, params) => listElements(token, method, params));
  return { id: iblockId, fieldMap };
}

async function fetchStatuses(token: TokenRef): Promise<ProjectStatus[]> {
  const iblock = await findIblock(token);
  if (!iblock) return [];
  const elements = await listElements(token, 'lists.element.get', {
    IBLOCK_TYPE_ID: STATUS_LIST_TYPE_ID,
    IBLOCK_ID: iblock.id,
  });
  return (elements || [])
    .map((element: Record<string, unknown>) => mapStatusElement(element, iblock.fieldMap))
    .filter(Boolean) as ProjectStatus[];
}

export async function getMemberToken(memberId: string): Promise<TokenRef | null> {
  const db = await getDb();
  return (await db
    .collection('user_tokens')
    .findOne({ member_id: memberId })) as unknown as TokenRef | null;
}

// Статусы всех порталов лежат в одной коллекции: вместо этого сужаем выборку
// по проекту — записи уникальны по projectId.
async function readMirror(): Promise<ProjectStatus[]> {
  const db = await getDb();
  const rows = await db.collection('project_status').find({}).toArray();
  return rows.map((row) => ({
    projectId: String(row.projectId),
    client: String(row.client || ''),
    status: String(row.status || ''),
    goal: String(row.goal || ''),
    state: String(row.state || ''),
    step: String(row.step || ''),
    stepDeadline: row.stepDeadline ? new Date(row.stepDeadline).toISOString() : '',
    risk: String(row.risk || ''),
    ownerId: String(row.ownerId || ''),
    updatedAt: row.updatedAt || row.updated_at || new Date().toISOString(),
  }));
}

async function writeMirror(statuses: ProjectStatus[]) {
  const db = await getDb();
  const collection = db.collection('project_status');
  for (const status of statuses) {
    await collection.updateOne(
      { projectId: status.projectId },
      { $set: { ...status, synced_at: new Date() } },
      { upsert: true },
    );
  }
}

// Подписи полей в истории: ключи совпадают с payload.
const TRACKED_FIELDS: { key: keyof ProjectStatus; label: string }[] = [
  { key: 'client', label: 'Клиент' },
  { key: 'status', label: 'Статус' },
  { key: 'goal', label: 'Цель' },
  { key: 'state', label: 'Текущее состояние' },
  { key: 'step', label: 'Ближайший шаг' },
  { key: 'stepDeadline', label: 'Срок шага' },
  { key: 'risk', label: 'Главный риск' },
  { key: 'ownerId', label: 'Ответственный' },
];

async function appendHistory(
  memberId: string,
  previous: ProjectStatus | null,
  next: ProjectStatus,
): Promise<void> {
  const changes: { field: string; from: string; to: string }[] = [];
  for (const { key, label } of TRACKED_FIELDS) {
    const old = previous ? String(previous[key] ?? '') : '';
    const value = String(next[key] ?? '');
    if (old === value) continue;
    changes.push({ field: label, from: previous ? old : '', to: value });
  }
  if (!changes.length) return;
  const db = await getDb();
  // Таймлайн проекта: что и когда менялось. Запись без изменений полей историю не растит.
  await db.collection('project_status_history').insertOne({
    projectId: next.projectId,
    memberId,
    changes,
    at: new Date(),
  });
}

export async function GET(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHORIZATION_REQUIRED' }, { status: 401 });

  // Таймлайн отдельным запросом: лента проекта от свежих к старым.
  const historyProject = req.nextUrl.searchParams.get('history_project_id');
  if (historyProject) {
    const db = await getDb();
    const rows = await db
      .collection('project_status_history')
      .find({ projectId: historyProject })
      .sort({ at: -1 })
      .limit(200)
      .toArray();
    return NextResponse.json({
      timeline: rows.map((row) => ({
        memberId: String(row.memberId || ''),
        changes: row.changes || [],
        at: row.at instanceof Date ? row.at.toISOString() : String(row.at),
      })),
    });
  }

  // Mock-режим (демо и UI-тесты) читает сеянные записи из Mongo, живой портал
  // не вызывается.
  if (isMockEnabled()) {
    return NextResponse.json({ statuses: await readMirror() });
  }

  try {
    const token = await getMemberToken(memberId);
    if (!token?.access_token || !token.domain)
      return NextResponse.json({ error: 'NO_TOKEN' }, { status: 401 });
    await ensureStatusList((method, params) => listElements(token, method, params as any));
    const statuses = await fetchStatuses(token);
    await writeMirror(statuses);
    return NextResponse.json({ statuses });
  } catch (error) {
    // Портал недоступен — отдаём зеркало, чтобы сводка оставалась читаемой.
    console.warn('[project-status] список недоступен, читаем зеркало:', error);
    return NextResponse.json({ statuses: await readMirror() });
  }
}

export async function PUT(req: NextRequest) {
  const memberId = await getAuthorizedMemberId(req.cookies.get(sessionCookie.name)?.value);
  if (!memberId) return NextResponse.json({ error: 'AUTHORIZATION_REQUIRED' }, { status: 401 });

  let values: ReturnType<typeof validateStatusPayload>;
  try {
    values = validateStatusPayload(await req.json());
  } catch {
    return NextResponse.json({ error: 'VALIDATION_FAILED' }, { status: 400 });
  }

  const record: ProjectStatus = { ...values, updatedAt: new Date().toISOString() };
  const db = await getDb();

  if (isMockEnabled()) {
    const previous = await readMirror();
    const before = previous.find((row) => row.projectId === values.projectId) || null;
    await db
      .collection('project_status')
      .updateOne({ projectId: values.projectId }, { $set: record }, { upsert: true });
    await appendHistory(memberId, before, record);
    return NextResponse.json({ status: record });
  }

  try {
    const token = await getMemberToken(memberId);
    if (!token?.access_token || !token.domain)
      return NextResponse.json({ error: 'NO_TOKEN' }, { status: 401 });
    await ensureStatusList((method, params) => listElements(token, method, params as any));
    const iblock = await findIblock(token);
    if (!iblock) throw new Error('STATUS_LIST_MISSING');
    const code = elementCode(values.projectId);
    const existing = await listElements(token, 'lists.element.get', {
      IBLOCK_TYPE_ID: STATUS_LIST_TYPE_ID,
      IBLOCK_ID: iblock.id,
      ELEMENT_CODE: code,
    });
    // Мутация ровно одна за запрос (правило одиночных мутаций): сначала
    // ищем элемент, потом по результату update или add.
    const payload = {
      IBLOCK_TYPE_ID: STATUS_LIST_TYPE_ID,
      IBLOCK_ID: iblock.id,
      ELEMENT_CODE: code,
    };
    if (existing && existing.length) {
      await listElements(token, 'lists.element.update', {
        ...payload,
        ELEMENT_ID: String(existing[0].ID),
        FIELDS: elementFields(values, iblock.fieldMap),
      });
    } else {
      await listElements(token, 'lists.element.add', {
        ...payload,
        FIELDS: elementFields(values, iblock.fieldMap),
      });
    }
    const before = (await readMirror()).find((row) => row.projectId === values.projectId) || null;
    await appendHistory(memberId, before, record);
    await writeMirror([record]);
    return NextResponse.json({ status: record });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'SAVE_FAILED';
    console.warn('[project-status] сохранение не прошло:', message);
    return NextResponse.json({ error: 'SAVE_FAILED', message }, { status: 502 });
  }
}
