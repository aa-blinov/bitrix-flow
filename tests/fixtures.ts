// Тест ходит в сервер и базу своего потока: parallelIndex не выходит за число
// потоков и сохраняется, когда упавший поток перезапускается.
import { test as base } from '@playwright/test';
import { dbName, serverUrl, statePath } from './workers';

export const test = base.extend<{ testDb: string }>({
  baseURL: async ({}, provide, testInfo) => provide(serverUrl(testInfo.parallelIndex)),
  storageState: async ({}, provide, testInfo) => provide(statePath(testInfo.parallelIndex)),
  testDb: async ({}, provide, testInfo) => provide(dbName(testInfo.parallelIndex)),
});
export { expect } from '@playwright/test';
export type { Locator, Page } from '@playwright/test';
