import { beforeEach, describe, expect, it } from 'vitest';
import { loadFromStorage, saveToStorage } from './persist';

const values: Record<string, string> = {};

beforeEach(() => {
  for (const key of Object.keys(values)) delete values[key];
  // @ts-expect-error - minimal browser storage stub for this module.
  globalThis.window = {};
  globalThis.localStorage = {
    getItem: (key: string) => values[key] ?? null,
    setItem: (key: string, value: string) => { values[key] = value; },
    removeItem: (key: string) => { delete values[key]; },
  } as Storage;
});

describe('saveToStorage', () => {
  it('keeps project cache when stages are saved separately', () => {
    saveToStorage({ projects: [{ id: '1' }] });
    saveToStorage({ stages: { '1': [{ id: 'new' }] } });

    expect(loadFromStorage()).toEqual({
      projects: [{ id: '1' }],
      stages: { '1': [{ id: 'new' }] },
    });
  });
});
