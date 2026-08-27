import { getDb } from './mongo';
import { getOAuthTokenUrl } from './bitrix-oauth-server';

const CLIENT_ID = process.env.BITRIX24_CLIENT_ID!;
const CLIENT_SECRET = process.env.BITRIX24_CLIENT_SECRET!;

// Refresh токена если истек
async function refreshToken(member_id: string): Promise<string> {
  const db = await getDb();
  const token = await db.collection('user_tokens').findOne({ member_id });

  if (!token) throw new Error('No token found');

  // Проверяем не истек ли
  const expiresAt = new Date(token.updated_at).getTime() + token.expires_in * 1000;
  if (Date.now() < expiresAt - 60000) {
    return token.access_token;
  }

  // Refresh
  const res = await fetch(getOAuthTokenUrl(token.oauth_server), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: token.refresh_token,
    }),
  });

  const newTokens = await res.json();

  if (newTokens.error) throw new Error(newTokens.error_description);

  await db.collection('user_tokens').updateOne(
    { member_id },
    {
      $set: {
        access_token: newTokens.access_token,
        refresh_token: newTokens.refresh_token,
        expires_in: newTokens.expires_in,
        updated_at: new Date(),
      },
    },
  );

  return newTokens.access_token;
}

// Вызов API от имени пользователя
export async function bx24OAuth(
  member_id: string,
  method: string,
  params: Record<string, any> = {},
): Promise<any> {
  const db = await getDb();
  const token = await db.collection('user_tokens').findOne({ member_id });

  if (!token) throw new Error('No token for user');

  const webhookUrl = `https://${token.domain}/rest/${method}?auth=${token.access_token}`;

  let res = await fetch(webhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params as any).toString(),
  });

  // Если 401 или token expired - refresh и retry
  if (res.status === 401) {
    await refreshToken(member_id);
    const newToken = await db.collection('user_tokens').findOne({ member_id });

    const retryUrl = `https://${newToken!.domain}/rest/${method}?auth=${newToken!.access_token}`;
    res = await fetch(retryUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params as any).toString(),
    });
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error_description);
  return data.result;
}
