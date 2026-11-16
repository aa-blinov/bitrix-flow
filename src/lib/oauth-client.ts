import { getDb } from './mongo';
import { postBitrixJson } from './bitrix-request';

const CLIENT_ID = process.env.BITRIX24_CLIENT_ID!;
const CLIENT_SECRET = process.env.BITRIX24_CLIENT_SECRET!;

// Refresh токена если истек
// rejected: токен, который портал только что отклонил. Портал отзывает токен и раньше
// расчётного срока, поэтому по часам его не прощаем: если в базе всё ещё он, обновляем.
// Токен человека живёт в person_tokens, токен портала в user_tokens: обновляем ту запись,
// из которой его взяли.
function tokenSource(member_id: string, asUser?: string) {
  return asUser
    ? { collection: 'person_tokens', filter: { member_id, user_id: asUser } }
    : { collection: 'user_tokens', filter: { member_id } };
}

async function refreshToken(
  member_id: string,
  rejected?: string,
  asUser?: string,
): Promise<string> {
  const db = await getDb();
  const source = tokenSource(member_id, asUser);
  const token = await db.collection(source.collection).findOne(source.filter);

  if (!token) throw new Error('No token found');

  // Другой запрос уже обновил токен: берём новый, а не тратим refresh_token повторно.
  if (rejected && token.access_token !== rejected) return token.access_token;
  const expiresAt = new Date(token.updated_at).getTime() + token.expires_in * 1000;
  if (!rejected && Date.now() < expiresAt - 60000) {
    return token.access_token;
  }

  // Refresh
  const res = await fetch('https://oauth.bitrix.info/oauth/token/', {
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

  await db.collection(source.collection).updateOne(source.filter, {
    $set: {
      access_token: newTokens.access_token,
      refresh_token: newTokens.refresh_token,
      expires_in: newTokens.expires_in,
      updated_at: new Date(),
    },
  });

  return newTokens.access_token;
}

// Вызов API от имени пользователя
export async function bx24OAuth(
  member_id: string,
  method: string,
  params: Record<string, any> | unknown[] = {},
  // Гонку по нескольким адресам портала включаем только для чтения: часть
  // адресов регулярно не отвечает, и одиночная попытка роняла фоновый проход.
  // v3 — адрес rest/api (у этих методов другой набор полей), json — тело
  // запроса уходит JSON-объектом, а не формой.
  // asUser: id пользователя Битрикса, от чьего имени вызов. Без него идёт токен портала,
  // это только для фона (зеркало, сбор часов, события).
  options: { parallel?: boolean; v3?: boolean; json?: boolean; asUser?: string } = {},
): Promise<any> {
  const db = await getDb();
  const source = tokenSource(member_id, options.asUser);
  const token = await db.collection(source.collection).findOne(source.filter);

  // Без своего токена человек не действует через чужой: это ошибка, а не запасной путь.
  if (!token) throw Object.assign(new Error('No token for user'), { portalCode: 'NO_TOKEN' });

  const call = (accessToken: string) =>
    postBitrixJson(
      `https://${token.domain}/${options.v3 ? 'rest/api' : 'rest'}/${method}?auth=${accessToken}`,
      params,
      options.json ?? Array.isArray(params),
      options.parallel === true,
    );

  // Ответ портала обязан быть объектом: на null обращение к data.error упало бы
  // TypeError, а его обвязка приняла бы за точный отказ, хотя мутация могла пройти.
  const checked = async (accessToken: string) => {
    const body = await call(accessToken);
    if (!body || typeof body !== 'object') throw new Error('BITRIX24_INVALID_RESPONSE');
    return body;
  };
  let data = await checked(token.access_token);
  if (data.error === 'expired_token' || data.error === 'invalid_token') {
    data = await checked(await refreshToken(member_id, token.access_token, options.asUser));
  }
  // Код ошибки портала идёт отдельным полем: по нему вызывающий отличает «нет доступа»
  // от прочих отказов. Не code: так Node называет ошибки сети.
  if (data.error)
    throw Object.assign(new Error(data.error_description || data.error), {
      portalCode: String(data.error),
    });
  return data.result;
}
