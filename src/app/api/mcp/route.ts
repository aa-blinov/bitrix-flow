// MCP поверх Streamable HTTP без состояния: каждый POST несёт один JSON-RPC и получает ответ
// JSON, без SSE и сессий MCP. Протокол здесь это четыре метода, поэтому SDK не тянем: он
// принёс бы зависимость и транспорт под Node-потоки ради того, что умещается в этот файл.
import { NextRequest, NextResponse } from 'next/server';
import { mcpSessionCookie, userByMcpToken } from '@/lib/mcp-tokens';
import { resourceMetadataUrl } from '@/lib/mcp-oauth';
import { TOOLS, ToolError } from './tools';
import { version } from '../../../../package.json';

export const dynamic = 'force-dynamic';

const PROTOCOL_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

type RpcId = string | number | null;
const reply = (id: RpcId, result: unknown) => NextResponse.json({ jsonrpc: '2.0', id, result });
const fail = (id: RpcId, code: number, message: string, status = 200) =>
  NextResponse.json({ jsonrpc: '2.0', id, error: { code, message } }, { status });

function unauthorized() {
  return NextResponse.json(
    { error: 'AUTHENTICATION_REQUIRED' },
    {
      status: 401, // По этому заголовку коннектор находит сервер авторизации (RFC 9728).
      headers: { 'WWW-Authenticate': `Bearer resource_metadata="${resourceMetadataUrl()}"` },
    },
  );
}

export async function POST(req: NextRequest) {
  // Проверка здесь, а не в proxy.ts: маршрут в PUBLIC_PATHS, потому что у клиента MCP нет
  // сессионной куки. Токен 256 бит, перебор не реален, поэтому отдельного лимита попыток нет.
  const bearer = req.headers.get('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1] || '';
  const owner = bearer ? await userByMcpToken(bearer) : null;
  if (!owner) return unauthorized();

  const message = await req.json().catch(() => null);
  if (!message || typeof message !== 'object' || Array.isArray(message))
    return fail(null, -32600, 'Invalid Request', 400);
  const {
    id = null,
    method,
    params,
  } = message as {
    id?: RpcId;
    method?: unknown;
    params?: Record<string, any>;
  };
  // Уведомления и ответы клиента ответа не ждут.
  if (!('id' in message)) return new NextResponse(null, { status: 202 });

  switch (method) {
    case 'initialize': {
      const asked = String(params?.protocolVersion || '');
      return reply(id, {
        protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'bitrixflow', version },
        instructions:
          'Задачи и проекты Bitrix24 из BitrixFlow: поиск и карточки задач, личный план, реестр ' +
          'проектов со статусами и метриками. Единственная запись это update_project_status. ' +
          'Ответы несут ссылку url в BitrixFlow.',
      });
    }
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, {
        tools: TOOLS.map(({ name, description, inputSchema, annotations }) => ({
          name,
          description,
          inputSchema,
          annotations: { readOnlyHint: true, openWorldHint: false, ...annotations },
        })),
      });
    case 'tools/call': {
      const tool = TOOLS.find((item) => item.name === params?.name);
      if (!tool) return fail(id, -32602, `Unknown tool: ${String(params?.name)}`);
      const args =
        params?.arguments && typeof params.arguments === 'object' ? params.arguments : {};
      try {
        const cookie = await mcpSessionCookie(owner.key, owner.user);
        const result = await tool.run(args, cookie);
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
      } catch (error) {
        // Ошибка тула уходит модели как результат: она может поправить аргументы и повторить.
        if (!(error instanceof ToolError)) console.error('[mcp]', tool.name, error);
        const text = error instanceof ToolError ? error.message : 'Внутренняя ошибка';
        return reply(id, { content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      return fail(id, -32601, `Method not found: ${String(method)}`);
  }
}

// Сервер без состояния: потока событий для GET и сессии для DELETE нет.
export function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: 'POST' } });
}
