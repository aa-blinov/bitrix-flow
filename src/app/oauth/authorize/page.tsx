import { cookies } from 'next/headers';
import OAuthConsent from '@/components/OAuthConsent';
import { findClient, redirectMatches, validResource } from '@/lib/mcp-oauth';
import { getSessionPerson } from '@/lib/people';
import { sessionCookie } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Search = Promise<Record<string, string | string[] | undefined>>;

// Согласие на подключение коннектора MCP. Без сессии сюда не попасть: proxy уводит на вход
// через Битрикс и возвращает обратно по next. Ошибки клиента и адреса возврата показываем здесь,
// а не уводим по адресу: непроверенный адрес возврата превратил бы страницу в открытый редирект.
export default async function AuthorizePage({ searchParams }: { searchParams: Search }) {
  const raw = await searchParams;
  const param = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '');
  const person = await getSessionPerson((await cookies()).get(sessionCookie.name)?.value);
  const client = await findClient(param('client_id'));
  const redirectUri = param('redirect_uri');

  let problem: 'person' | 'client' | 'request' | null = null;
  if (!person) problem = 'person';
  else if (!client || !redirectMatches(client.redirect_uris, redirectUri)) problem = 'client';
  else if (
    param('response_type') !== 'code' ||
    param('code_challenge_method') !== 'S256' ||
    !param('code_challenge') ||
    !validResource(param('resource'))
  )
    problem = 'request';

  return (
    <OAuthConsent
      problem={problem}
      clientName={client?.client_name || ''}
      redirectHost={problem === 'client' ? '' : safeHost(redirectUri)}
      personName={person?.user.display_name || person?.user.username || ''}
      request={{
        client_id: param('client_id'),
        redirect_uri: redirectUri,
        code_challenge: param('code_challenge'),
        state: param('state'),
        resource: param('resource'),
      }}
    />
  );
}

function safeHost(value: string) {
  try {
    const url = new URL(value);
    return url.host || url.protocol.replace(/:$/, '');
  } catch {
    return '';
  }
}
