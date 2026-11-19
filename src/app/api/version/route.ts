import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export const dynamic = 'force-dynamic';

// Идентификатор сборки читается один раз на процесс: в рамках живого процесса
// он меняться не может, а новый деплой — это новый процесс.
let cachedVersion: string | null = null;

export async function GET() {
  try {
    if (!cachedVersion) {
      cachedVersion = (
        await readFile(path.join(process.cwd(), '.next', 'BUILD_ID'), 'utf8')
      ).trim();
    }
    return NextResponse.json({ version: cachedVersion });
  } catch {
    // Без BUILD_ID (например, dev-режим) сравнивать нечем: клиент молчит.
    return NextResponse.json({ version: null });
  }
}
