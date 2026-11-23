import { describe, expect, it } from 'vitest';
import { pageNumbers } from './pagination';

describe('pageNumbers', () => {
  it('дописывает одну пропущенную страницу и ставит многоточие на большой пропуск', () => {
    expect(pageNumbers(1, 4)).toEqual([1, 2, 3, 4]);
    expect(pageNumbers(1, 38)).toEqual([1, 2, 0, 38]);
    expect(pageNumbers(10, 38)).toEqual([1, 0, 9, 10, 11, 0, 38]);
    expect(pageNumbers(1, 1)).toEqual([1]);
  });
});
