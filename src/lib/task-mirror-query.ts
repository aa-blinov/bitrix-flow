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
  groupId: {
    $convert: {
      input: { $ifNull: ['$data.group.id', { $ifNull: ['$data.groupId', '$data.GROUP_ID'] }] },
      to: 'string',
      onError: '',
      onNull: '',
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
  estimate: { $ifNull: ['$data.timeEstimate', '$data.TIME_ESTIMATE'] },
  actual: { $ifNull: ['$data.timeSpentInLogs', '$data.TIME_SPENT_IN_LOGS'] },
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
        },
      },
    ] as Record<string, unknown>[],
  };
}
