import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const userByMcpToken = vi.fn();
vi.mock('@/lib/mcp-tokens', () => ({
  userByMcpToken: (token: string) => userByMcpToken(token),
  mcpSessionCookie: async () => 'cookie',
}));
vi.mock('./tools', () => {
  class ToolError extends Error {}
  return {
    ToolError,
    TOOLS: [
      {
        name: 'echo',
        description: '',
        inputSchema: { type: 'object' },
        run: async (args: { fail?: string; crash?: boolean }) => {
          if (args.fail) throw new ToolError(args.fail);
          if (args.crash) throw new Error('secret internals');
          return args;
        },
      },
    ],
  };
});

const { POST } = await import('./route');

const call = (body: unknown, token = 'bf_good') =>
  POST(
    new NextRequest('http://x/api/mcp', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : {},
      body: JSON.stringify(body),
    }),
  );

describe('MCP route', () => {
  beforeEach(() => {
    userByMcpToken.mockImplementation(async (token: string) =>
      token === 'bf_good' ? { user: { _id: 'u1' }, key: 'k' } : null,
    );
  });

  it('rejects requests without a live token before reading the body', async () => {
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'ping' }, '')).status).toBe(401);
    expect((await call({ jsonrpc: '2.0', id: 1, method: 'ping' }, 'bf_bad')).status).toBe(401);
  });

  it('negotiates the protocol version and acknowledges notifications', async () => {
    const init = await (
      await call({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-06-18' },
      })
    ).json();
    expect(init.result.protocolVersion).toBe('2025-06-18');
    const unknown = await (
      await call({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '1999' },
      })
    ).json();
    expect(unknown.result.protocolVersion).toBe('2025-11-25');
    expect((await call({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
  });

  it('marks tools read-only and turns tool failures into results', async () => {
    const list = await (await call({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json();
    expect(list.result.tools[0].annotations.readOnlyHint).toBe(true);

    const run = (args: object) =>
      call({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'echo', arguments: args },
      }).then((response) => response.json());
    expect(JSON.parse((await run({ a: 1 })).result.content[0].text)).toEqual({ a: 1 });
    expect((await run({ fail: 'bad id' })).result).toMatchObject({
      isError: true,
      content: [{ text: 'bad id' }],
    });
    // Текст чужой ошибки модели не отдаём: в нём бывают строки подключения и токены.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await run({ crash: true })).result.content[0].text).not.toContain('secret');

    const missing = await (
      await call({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'nope' } })
    ).json();
    expect(missing.error.code).toBe(-32602);
  });
});

describe('decodeEntities', () => {
  it('turns portal entities back into text', async () => {
    const { decodeEntities } = await vi.importActual<typeof import('./tools')>('./tools');
    expect(decodeEntities('&#91;b&#93; &quot;x&quot; &amp;amp; &#x41; &bogus;')).toBe(
      '[b] "x" &amp; A &bogus;',
    );
  });
});
