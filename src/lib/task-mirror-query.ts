import type { Db } from 'mongodb';
import { getDb } from '@/lib/mongo';

// Нормализация task_mirror: полезная нагрузка приходит и из REST, и из вебхуков,
// поэтому у полей два регистра. Приводим один раз — этими же полями фильтрует
// /api/tasks/all и агрегирует /api/workload/summary, иначе числа в списке и в
// календаре нагрузки расходятся.
export const normalizedTaskFields = {
  taskId: {
    $convert: {
      input: { $ifNull: ['$data.id', '$data.ID'] },
      to: 'string',
      onError: '',
      onNull: '',
    },
  },
  title: { $ifNull: ['$data.title', '$data.TITLE'] },
  description: { $ifNull: ['$data.description', '$data.DESCRIPTION'] },
  // Чат задачи: без него карточка тянула задачу ещё раз, только чтобы узнать
  // id чата для чтения комментариев.
  chatId: {
    $convert: {
      input: { $ifNull: ['$data.chatId', '$data.CHAT_ID'] },
      to: 'string',
      onError: '',
      onNull: '',
    },
  },
  rawStatus: {
    $convert: {
      input: { $ifNull: ['$data.status', '$data.STATUS'] },
      to: 'string',
      onError: '',
      onNull: '',
    },
  },
  // У задачи вне проекта Bitrix отдаёт group пустым массивом, а $ifNull массив
  // за null не считает — $convert падал, и groupId выходил пустой строкой
  // вместо '0'. Из-за этого задачи без проекта не находились ни одним фильтром.
  groupId: {
    $let: {
      vars: {
        raw: {
          $cond: [
            { $eq: [{ $type: '$data.group' }, 'object'] },
            '$data.group.id',
            { $ifNull: ['$data.groupId', '$data.GROUP_ID'] },
          ],
        },
      },
      in: {
        $let: {
          vars: {
            text: { $convert: { input: '$$raw', to: 'string', onError: '0', onNull: '0' } },
          },
          in: { $cond: [{ $eq: ['$$text', ''] }, '0', '$$text'] },
        },
      },
    },
  },
  groupName: {
    $ifNull: ['$data.group.name', { $ifNull: ['$data.groupName', '$data.GROUP_NAME'] }],
  },
  responsibleId: {
    $convert: {
      input: {
        $ifNull: [
          '$data.responsible.id',
          { $ifNull: ['$data.responsibleId', '$data.RESPONSIBLE_ID'] },
        ],
      },
      to: 'string',
      onError: '',
      onNull: '',
    },
  },
  responsibleName: {
    $ifNull: [
      '$data.responsible.name',
      { $ifNull: ['$data.responsibleName', '$data.RESPONSIBLE_NAME'] },
    ],
  },
  creatorId: {
    $convert: {
      input: {
        $ifNull: ['$data.creator.id', { $ifNull: ['$data.createdBy', '$data.CREATED_BY'] }],
      },
      to: 'string',
      onError: '',
      onNull: '',
    },
  },
  // Соисполнители и наблюдатели приходят массивом id (или отсутствуют вовсе).
  accompliceIds: {
    $map: {
      input: {
        $let: {
          vars: { raw: { $ifNull: ['$data.accomplices', '$data.ACCOMPLICES'] } },
          in: { $cond: [{ $isArray: '$$raw' }, '$$raw', []] },
        },
      },
      as: 'id',
      in: { $toString: '$$id' },
    },
  },
  auditorIds: {
    $map: {
      input: {
        $let: {
          vars: { raw: { $ifNull: ['$data.auditors', '$data.AUDITORS'] } },
          in: { $cond: [{ $isArray: '$$raw' }, '$$raw', []] },
        },
      },
      as: 'id',
      in: { $toString: '$$id' },
    },
  },
  changedDate: { $ifNull: ['$data.changedDate', '$data.CHANGED_DATE'] },
  createdDate: { $ifNull: ['$data.createdDate', '$data.CREATED_DATE'] },
  deadline: { $ifNull: ['$data.deadline', '$data.DEADLINE'] },
  priorityValue: { $ifNull: ['$data.priority', '$data.PRIORITY'] },
  stageId: {
    $convert: {
      input: { $ifNull: ['$data.stageId', '$data.STAGE_ID'] },
      to: 'string',
      onError: '',
      onNull: '0',
    },
  },
  // Битрикс отдаёт часы строкой («108000»), а Mongo сравнивает строку с числом
  // по типу, а не по значению: без приведения «факт больше плана» срабатывало
  // почти на всех задачах, и сортировка по часам шла лексикографически.
  estimate: {
    $convert: {
      input: { $ifNull: ['$data.timeEstimate', '$data.TIME_ESTIMATE'] },
      to: 'double',
      onError: 0,
      onNull: 0,
    },
  },
  actual: {
    $convert: {
      input: { $ifNull: ['$data.timeSpentInLogs', '$data.TIME_SPENT_IN_LOGS'] },
      to: 'double',
      onError: 0,
      onNull: 0,
    },
  },
  comments: { $ifNull: ['$data.commentsCount', '$data.COMMENTS_COUNT'] },
  parent: { $ifNull: ['$data.parentId', '$data.PARENT_ID'] },
  // Штатные теги приходят объектом id -> { id, title }; нам нужны названия.
  bitrixTags: {
    $map: {
      input: {
        $cond: [
          { $eq: [{ $type: { $ifNull: ['$data.tags', '$data.TAGS'] } }, 'object'] },
          { $objectToArray: { $ifNull: ['$data.tags', '$data.TAGS'] } },
          [],
        ],
      },
      as: 'entry',
      in: { $ifNull: ['$$entry.v.title', '$$entry.v.TITLE'] },
    },
  },
};

// Ключ дня в календаре нагрузки считает браузер по локальной зоне, поэтому
// $dateToString должен работать с тем же смещением, иначе задача с дедлайном
// в 23:00 уедет в соседний день.
export function timezoneOffsetString(date: Date) {
  const minutes = -date.getTimezoneOffset();
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

// Свежесть строки определяется временем её записи: `task_mirror` обновляется
// сразу после правки в интерфейсе, а `tasks` — только на ближайшем проходе
// поллера. Раньше приоритет отдавался коллекции `tasks` без учёта времени:
// отсортированная по priority выборка брала её строку всегда, и свежая правка
// из зеркала терялась до следующего прохода поллера (до минуты).
//
// Пайплайн вынесен в отдельную функцию, чтобы правило сортировки можно было
// проверить в тестах без поднятой MongoDB.
export function taskMergeStages(memberId: string): Record<string, unknown>[] {
  return [
    { $match: { member_id: memberId } },
    { $set: { priority: 0, freshAt: { $ifNull: ['$synced_at', '$updated_at'] } } },
    {
      $unionWith: {
        coll: 'tasks',
        pipeline: [
          { $match: { member_id: memberId } },
          { $set: { priority: 1, freshAt: '$updated_at' } },
        ],
      },
    },
    // Сначала свежесть, при равенстве — коллекция фонового синка.
    { $sort: { id: 1, freshAt: -1, priority: -1 } },
    // Коллекции хранят разный набор полей: у полного снимка задачи их 70+, у
    // фонового списка — 25, и там нет ни chatId, ни прав на действия (action),
    // ни счётчика комментариев. Раньше бралась целиком свежайшая строка, и
    // карточка теряла эти поля вместе с ними. Теперь берём обе: свежая
    // побеждает, а пробелы добираются из полного снимка.
    { $group: { _id: '$id', rows: { $push: '$data' } } },
    { $set: { data: mergeRows() } },
    { $unset: 'rows' },
    { $set: normalizedTaskFields },
    {
      $set: {
        deadlineDate: {
          $convert: { input: '$deadline', to: 'date', onError: null, onNull: null },
        },
        createdAt: {
          $convert: { input: '$createdDate', to: 'date', onError: null, onNull: null },
        },
        changedAt: {
          $convert: { input: '$changedDate', to: 'date', onError: null, onNull: null },
        },
      },
    },
  ];
}

// Две строки задачи в одно поле: первая (свежая) побеждает, но пустые
// значения в ней — это «поля нет», а не «значение пустое», поэтому пробелы
// добираются из второй строки.
function mergeRows(): Record<string, unknown> {
  // $rows.0 у массива документов читается как «поле 0 у каждого» — берём
  // элемент через $arrayElemAt.
  const withoutEmpties = (index: number) => ({
    $arrayToObject: {
      $filter: {
        input: { $objectToArray: { $ifNull: [{ $arrayElemAt: ['$rows', index] }, {}] } },
        as: 'kv',
        cond: { $and: [{ $ne: ['$$kv.v', ''] }, { $ne: ['$$kv.v', null] }] },
      },
    },
  });
  return {
    $mergeObjects: [withoutEmpties(1), withoutEmpties(0)],
  };
}

// Склейка двух коллекций дорогая: на 2800 задачах около 0,5 с, и платил её каждый запрос
// списка (медиана /api/tasks/all была 1 с). Поэтому готовая склейка лежит в своей коллекции
// и пересобирается, только когда меняются исходные: отпечаток это число записей и последние
// метки времени обеих коллекций, его подсчёт стоит миллисекунды. Все записи в task_mirror
// и tasks ставят updated_at или synced_at, на этом держится свежесть.
const built = new Map<string, string>();
const pending = new Map<string, { version: string; done: Promise<void> }>();

const mergedCollection = (memberId: string) => `task_merged_${memberId}`;

async function sourceVersion(db: Db, memberId: string) {
  const stamp = (coll: string, fields: string[]) =>
    db
      .collection(coll)
      .aggregate([
        { $match: { member_id: memberId } },
        {
          $group: {
            _id: null,
            n: { $sum: 1 },
            ...Object.fromEntries(fields.map((field) => [field, { $max: `$${field}` }])),
          },
        },
      ])
      .next();
  const [mirror, tasks] = await Promise.all([
    stamp('task_mirror', ['updated_at', 'synced_at']),
    stamp('tasks', ['updated_at']),
  ]);
  return JSON.stringify([mirror, tasks]);
}

// Колонки канбана просят задачи пачкой одновременно: каждая считала отпечаток сама, и девять
// одинаковых агрегаций по обеим коллекциям выстраивались в очередь. Одновременные запросы
// ждут один подсчёт; следующий запрос после него считает заново, так что свежесть та же.
const counting = new Map<string, Promise<string>>();

function currentVersion(db: Db, memberId: string) {
  let job = counting.get(memberId);
  if (!job) {
    job = sourceVersion(db, memberId).finally(() => counting.delete(memberId));
    counting.set(memberId, job);
  }
  return job;
}

async function ensureMerged(db: Db, memberId: string) {
  const version = await currentVersion(db, memberId);
  if (built.get(memberId) === version) return;
  // Параллельные запросы при одной и той же смене ждут одну сборку, а не запускают свою.
  let job = pending.get(memberId);
  if (job?.version !== version) {
    const done = db
      .collection('task_mirror')
      .aggregate(
        [
          ...taskMergeStages(memberId),
          { $set: { member_id: memberId } },
          { $out: mergedCollection(memberId) },
        ],
        { allowDiskUse: true },
      )
      .toArray()
      .then(() => {
        built.set(memberId, version);
      })
      .finally(() => {
        if (pending.get(memberId)?.done === done) pending.delete(memberId);
      });
    job = { version, done };
    pending.set(memberId, job);
  }
  await job.done;
}

/**
 * Стадии для агрегации по task_mirror: $match по _id: null ничего не находит по индексу, и подмешивание готовой
 * склейки. Вызывающим ничего менять не надо: документы те же, что дал бы taskMergeStages.
 */
export async function taskMirrorStages(memberId: string) {
  const db = await getDb();
  await ensureMerged(db, memberId);
  return {
    db,
    stages: [
      { $match: { _id: null } },
      { $unionWith: { coll: mergedCollection(memberId), pipeline: [] } },
    ] as Record<string, unknown>[],
  };
}
