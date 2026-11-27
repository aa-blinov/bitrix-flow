import { NextResponse, type NextRequest } from 'next/server';
import { isValidSession, sessionCookie } from '@/lib/session';

const PUBLIC_PATHS = new Set([
  '/login',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/b24/handler',
  '/api/oauth',
  '/api/oauth/check',
  '/install',
  // Проверка живости нужна docker/мониторингу, у которых сессии нет.
  '/api/health',
  // Клиент MCP приходит с Bearer-токеном, а не с кукой: роут проверяет токен сам.
  '/api/mcp',
  // OAuth для коннекторов MCP: discovery, регистрация клиента и обмен кода открыты по
  // спецификации. Доступ даёт только согласие, а оно требует сессии (/oauth/authorize).
  '/.well-known/oauth-protected-resource',
  '/.well-known/oauth-protected-resource/api/mcp',
  '/.well-known/oauth-authorization-server',
  '/api/mcp-oauth/resource',
  '/api/mcp-oauth/server',
  '/api/mcp-oauth/register',
  '/api/mcp-oauth/token',
]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const authenticated = await isValidSession(request.cookies.get(sessionCookie.name)?.value);
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith('/api/')) {
    return NextResponse.json({ error: 'AUTHENTICATION_REQUIRED' }, { status: 401 });
  }

  const loginUrl = new URL('/login', request.url);
  loginUrl.searchParams.set('next', `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
