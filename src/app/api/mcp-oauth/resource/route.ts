import { NextResponse } from 'next/server';
import { appOrigin, mcpResource } from '@/lib/mcp-oauth';

export const dynamic = 'force-dynamic';

// RFC 9728: клиент MCP узнаёт отсюда, где брать токен. Отдаётся и по /.well-known (rewrite).
export function GET() {
  return NextResponse.json({
    resource: mcpResource(),
    authorization_servers: [appOrigin()],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
    resource_name: 'BitrixFlow',
  });
}
