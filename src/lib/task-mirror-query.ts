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

// Свежие записи фонового синка (`tasks`) перекрывают долговременное зеркало
// (`task_mirror`) по одному и тому же id.
export async function taskMirrorStages(memberId: string) {
  const db = await getDb();
  return {
    db,
    stages: [
      { $match: { member_id: memberId } },
      { $set: { priority: 0 } },
      {
        $unionWith: {
          coll: 'tasks',
          pipeline: [{ $match: { member_id: memberId } }, { $set: { priority: 1 } }],
        },
      },
      { $sort: { id: 1, priority: -1, updated_at: -1 } },
      { $group: { _id: '$id', data: { $first: '$data' } } },
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
    ] as Record<string, unknown>[],
  };
}
