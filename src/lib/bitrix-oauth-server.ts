const OAUTH_SERVERS = new Set(['oauth.bitrix.info', 'oauth.bitrix24.tech']);

export function getOAuthServer(value?: string) {
  return value && OAUTH_SERVERS.has(value) ? value : 'oauth.bitrix.info';
}

export function getOAuthTokenUrl(value?: string) {
  return `https://${getOAuthServer(value)}/oauth/token/`;
}
