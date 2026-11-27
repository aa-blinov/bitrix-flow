import { NextRequest, NextResponse } from 'next/server';
import {
  clientAuthenticated,
  consumeCode,
  findClient,
  pkceMatches,
  touchClient,
  validResource,
} from '@/lib/mcp-oauth';
import { issueOAuthGrant, refreshOAuthGrant } from '@/lib/mcp-tokens';
import { findUserById } from '@/lib/users';

export const dynamic = 'force-dynamic';

const error = (code: string, status = 400) =>
  NextResponse.json({ error: code }, { status, headers: { 'Cache-Control': 'no-store' } });

// Тело по RFC 6749 это форма, но часть клиентов шлёт JSON: принимаем оба.
async function readBody(req: NextRequest): Promise<Record<string, string>> {
  const type = req.headers.get('content-type') || '';
  if (type.includes('application/json')) {
    const json = await req.json().catch(() => null);
    return json && typeof json === 'object'
      ? Object.fromEntries(Object.entries(json).map(([key, value]) => [key, String(value)]))
      : {};
  }
  return Object.fromEntries(new URLSearchParams(await req.text()));
}

function basicCredentials(req: NextRequest) {
  const raw = req.headers.get('authorization')?.match(/^Basic\s+(\S+)$/i)?.[1];
  if (!raw) return null;
  const [id, secret] = Buffer.from(raw, 'base64').toString().split(':');
  return id ? { id: decodeURIComponent(id), secret: decodeURIComponent(secret || '') } : null;
}

export async function POST(req: NextRequest) {
  const body = await readBody(req);
  const basic = basicCredentials(req);
  const client = await findClient(basic?.id || body.client_id);
  if (!client || !clientAuthenticated(client, basic?.secret || body.client_secret || null))
    return error('invalid_client', 401);
  if (!validResource(body.resource)) return error('invalid_target');

  if (body.grant_type === 'authorization_code') {
    const code = await consumeCode(body.code || '');
    if (
      !code ||
      code.client_id !== client.client_id ||
      code.redirect_uri !== body.redirect_uri ||
      !pkceMatches(body.code_verifier || '', code.code_challenge)
    )
      return error('invalid_grant');
    const user = await findUserById(code.user_id);
    if (!user || user.blocked) return error('invalid_grant');
    await touchClient(client.client_id);
    const tokens = await issueOAuthGrant(code.user_id, client.client_id, client.client_name);
    return NextResponse.json(tokens, { headers: { 'Cache-Control': 'no-store' } });
  }

  if (body.grant_type === 'refresh_token') {
    const tokens = await refreshOAuthGrant(body.refresh_token || '', client.client_id);
    if (!tokens) return error('invalid_grant');
    await touchClient(client.client_id);
    return NextResponse.json(tokens, { headers: { 'Cache-Control': 'no-store' } });
  }

  return error('unsupported_grant_type');
}
