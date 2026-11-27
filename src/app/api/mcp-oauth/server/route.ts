import { NextResponse } from 'next/server';
import { appOrigin } from '@/lib/mcp-oauth';

export const dynamic = 'force-dynamic';

// RFC 8414. Только код с PKCE S256 и продление: implicit и пароль OAuth 2.1 запрещает.
export function GET() {
  const origin = appOrigin();
  return NextResponse.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/api/mcp-oauth/token`,
    registration_endpoint: `${origin}/api/mcp-oauth/register`,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['none', 'client_secret_post', 'client_secret_basic'],
    scopes_supported: ['mcp'],
  });
}
