import { describe, expect, it } from 'vitest';
import { NAV_ITEMS, resolveNavOrder } from './SortableNav';

const all = NAV_ITEMS.map((item) => item.href);

describe('resolveNavOrder', () => {
  it('keeps the saved order and appends items the saved list lacks', () => {
    const order = resolveNavOrder(['/search', '/']);
    expect(order.slice(0, 2)).toEqual(['/search', '/']);
    expect([...order].sort()).toEqual([...all].sort());
  });

  it('drops items that no longer exist and ignores duplicates and junk', () => {
    expect(resolveNavOrder(['/gone', '/search', '/search'])).toHaveLength(all.length);
    expect(resolveNavOrder(null)).toEqual(all);
    expect(resolveNavOrder('nope')).toEqual(all);
  });
});
