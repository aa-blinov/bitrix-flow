import { describe, expect, it } from 'vitest';
import { mapBitrixTaskStatus } from './task-status';

describe('mapBitrixTaskStatus', () => {
  it('maps every standard Bitrix status to a grid status', () => {
    expect(['1', '2', '3', '4', '5', '6'].map(mapBitrixTaskStatus)).toEqual([
      'new',
      'new',
      'in_progress',
      'testing',
      'done',
      'deferred',
    ]);
  });
});
