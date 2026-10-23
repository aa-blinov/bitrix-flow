import { describe, expect, it } from 'vitest';
import { boardStageQueries, coveredStageIds, NO_STAGE_ID } from './kanban-stage-queries';

describe('boardStageQueries', () => {
  it('asks for tasks without a phase together with the system "New" phase', () => {
    // Битрикс не отдаёт фазу «0» в task.stages.get, поэтому задачи без фазы
    // видны только отдельным запросом — иначе они пропадают с доски.
    const queries = boardStageQueries([
      { id: '21', systemType: 'NEW' },
      { id: '23', systemType: '' },
      { id: '25', systemType: '' },
    ]);

    expect(queries).toEqual([
      { columnId: '21', query: '21,0' },
      { columnId: '23', query: '23' },
      { columnId: '25', query: '25' },
    ]);
  });

  it('keeps other phases untouched', () => {
    const queries = boardStageQueries([
      { id: '683', systemType: 'NEW' },
      { id: '685', systemType: '' },
    ]);

    expect(queries.map((item) => item.query)).toEqual(['683,0', '685']);
  });

  it('does not duplicate the request when the "New" phase is the phase "0"', () => {
    const queries = boardStageQueries([
      { id: NO_STAGE_ID, systemType: 'NEW' },
      { id: 'in_progress', systemType: 'PROCESS' },
    ]);

    expect(queries).toEqual([
      { columnId: NO_STAGE_ID, query: NO_STAGE_ID },
      { columnId: 'in_progress', query: 'in_progress' },
    ]);
  });

  it('asks for tasks without a phase separately when the project has no system phase', () => {
    const queries = boardStageQueries([
      { id: '211', systemType: '' },
      { id: '215', systemType: '' },
    ]);

    expect(queries).toEqual([
      { columnId: '211', query: '211' },
      { columnId: '215', query: '215' },
      { columnId: NO_STAGE_ID, query: NO_STAGE_ID },
    ]);
  });

  it('returns nothing for a project without phases', () => {
    expect(boardStageQueries([])).toEqual([]);
  });
});

describe('coveredStageIds', () => {
  it('lists every stage the board already queries', () => {
    const stages = [
      { id: '21', systemType: 'NEW' },
      { id: '23', systemType: '' },
      { id: '25', systemType: '' },
    ];

    // Всё, что доска забрала отдельными запросами, не должно повторно
    // приезжать в колонку «Без фазы».
    expect(coveredStageIds(stages).sort()).toEqual(['0', '21', '23', '25']);
  });

  it('covers the separate no-phase column when the project has no system phase', () => {
    const stages = [
      { id: '211', systemType: '' },
      { id: '215', systemType: '' },
    ];

    expect(coveredStageIds(stages).sort()).toEqual(['0', '211', '215']);
  });

  it('covers nothing for a project without stages', () => {
    expect(coveredStageIds([])).toEqual([]);
  });
});
