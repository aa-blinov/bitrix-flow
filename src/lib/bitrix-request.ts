import { lookup } from 'node:dns';
import { Agent, request } from 'node:https';

// Pin every REST call to IPv4. The Bitrix portal publishes several AAAA
// records that are silently unreachable from this server; Node's default
// Happy-Eyeballs selection then times out the TLS handshake for the whole
// request. Forcing IPv4 makes every call deterministic and fast.
const ipv4Agent = new Agent({ family: 4, keepAlive: true, maxSockets: 8 });

// Живой edge портала соединяется за ~0.1 с. Раньше на соединение и ответ был
// один таймаут в 10 с: подвисший адрес стоил 10 с, а при переборе трёх групп
// карточка задачи открывалась по 30 с. Соединение (TCP + TLS) ждём коротко,
// ответ — долго: большие списки задач Битрикс собирает секундами.
const CONNECT_TIMEOUT_MS = 2_000;
// Ответ ждём долго: оборванная медленная мутация показала бы ошибку, хотя в
// Битриксе она уже сохранилась.
const RESPONSE_TIMEOUT_MS = 30_000;
const SLOW_CALL_MS = 2_000;
// Адрес, ответивший дольше, откладываем как мёртвый: edge 46.235.53.* бывает
// живым, но отвечает по 20+ с.
const SLOW_ADDRESS_MS = 3_000;
// Чтения повторять безопасно, поэтому их всегда гоняем по нескольким адресам,
// кто бы ни вызывал: /api/dashboard и фоновый sync читали по одному адресу и
// ждали медленный edge целиком.
const READ_METHOD = /\.(get|list|getlist|current)$|^server\.time$/i;

function isReadMethod(url: string) {
  const method = new URL(url).pathname.replace(/^\/rest\//, '').replace(/\.json$/, '');
  return READ_METHOD.test(method);
}
const MAX_PARALLEL = 3;
// Сколько групп адресов перебрать, прежде чем сдаться.
const MAX_GROUPS = 3;

// Some Bitrix24 portals return several A records. We probe a handful in
// parallel and take the first to answer — a single dead edge (and they
// exist, see eora.bitrix24.ru: 46.235.53.67 / .70 hang on TCP connect)
// must not stall the whole call for the full timeout, three times in a row.
// lastGoodAddress biases the next attempt to the address that just answered.
let lastGoodAddress: string | null = null;
// Мёртвые edge-адреса портала (у eora.bitrix24.ru это вся группа 46.235.53.*)
// висят на TCP-connect до таймаута. Раз наткнувшись, не выбираем их снова
// ближайшие минуты: иначе каждый третий запрос падал целиком.
const deadAddresses = new Map<string, number>();
// 5 минут было мало: адреса отваливаются надолго, и каждые 5 минут первый же
// запрос снова натыкался на мёртвый.
const DEAD_TTL_MS = 30 * 60 * 1000;

function isAlive(address: string) {
  const until = deadAddresses.get(address);
  if (!until) return true;
  if (until > Date.now()) return false;
  deadAddresses.delete(address);
  return true;
}

function markDead(address: string) {
  deadAddresses.set(address, Date.now() + DEAD_TTL_MS);
  if (lastGoodAddress === address) lastGoodAddress = null;
}

/**
 * Соединение не состоялось — запрос точно не дошёл, повтор безопасен.
 * Таймаут ответа сюда не входит: запрос мог уже выполниться, и повтор мутации
 * на другом адресе создал бы дубль.
 */
function isConnectFailure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as NodeJS.ErrnoException)?.code || '';
  return (
    message.includes('BITRIX24_CONNECT_TIMEOUT') ||
    [
      'ECONNREFUSED',
      'EHOSTUNREACH',
      'ENETUNREACH',
      'ECONNRESET',
      'EPIPE',
      'EAI_AGAIN',
      'ETIMEDOUT',
    ].includes(code)
  );
}

/** Отдельный короткий таймаут на TCP + TLS; сокет из keep-alive пула его не ждёт. */
function guardConnect(req: import('node:http').ClientRequest) {
  req.on('socket', (socket) => {
    if (!socket.connecting) return;
    const timer = setTimeout(
      () => req.destroy(new Error('BITRIX24_CONNECT_TIMEOUT')),
      CONNECT_TIMEOUT_MS,
    );
    socket.once('secureConnect', () => clearTimeout(timer));
    socket.once('close', () => clearTimeout(timer));
  });
  req.on('timeout', () => req.destroy(new Error('BITRIX24_RESPONSE_TIMEOUT')));
}

interface AddressEntry {
  address: string;
  family: number;
}

async function resolveAddresses(hostname: string): Promise<AddressEntry[]> {
  return new Promise((resolve, reject) => {
    lookup(hostname, { all: true, family: 4, verbatim: true }, (error, addresses) => {
      if (error || addresses.length === 0) {
        reject(error || new Error(`No IPv4 address for ${hostname}`));
        return;
      }
      resolve(addresses);
    });
  });
}

function pickProbes(pool: AddressEntry[], n: number): AddressEntry[] {
  // Prefer the address that answered last call; pad with the rest shuffled.
  const alive = pool.filter((entry) => isAlive(entry.address));
  const usable = alive.length ? alive : pool;
  const rest = usable.filter((a) => a.address !== lastGoodAddress);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const head = lastGoodAddress ? usable.filter((a) => a.address === lastGoodAddress) : [];
  return [...head, ...rest].slice(0, n);
}

function httpRequest(
  url: string,
  body: string,
  sendJson: boolean,
  lookupHostname: string,
): Promise<{ status: number; raw: string }> {
  return new Promise((resolve, reject) => {
    // Force a single address per attempt: pass a synchronous lookup that
    // returns the chosen entry so https doesn't fall back to Happy Eyeballs.
    const chosen = lookupHostname as unknown as string;
    const req = request(url, {
      method: 'POST',
      agent: ipv4Agent,
      lookup: (_host, _opts, cb) => cb(null, chosen, 4),
      servername: new URL(url).hostname,
      timeout: RESPONSE_TIMEOUT_MS,
      headers: {
        'Content-Type': sendJson ? 'application/json' : 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    });
    guardConnect(req);
    req.on('error', reject);
    req.on('response', (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        raw += chunk;
      });
      response.on('end', () => resolve({ status: response.statusCode || 0, raw }));
    });
    req.end(body);
  });
}

// Скачивание вложения. Тот же обход мёртвых edge-адресов, что и для REST, но
// GET и стримом: плейн fetch() висит 10 с на первом же неотвечающем адресе.
// Адреса пробуем по одному — параллельная гонка тянула бы файл дважды.
export async function getBitrixFileStream(url: string): Promise<{
  status: number;
  headers: Record<string, string | string[] | undefined>;
  stream: import('node:stream').Readable;
}> {
  const hostname = new URL(url).hostname;
  const pool = await resolveAddresses(hostname);
  const probes = pickProbes(pool, MAX_PARALLEL);
  let lastError: unknown = new Error('BITRIX24_REQUEST_FAILED');
  for (const entry of probes) {
    try {
      const response = await new Promise<import('node:http').IncomingMessage>((resolve, reject) => {
        const req = request(url, {
          method: 'GET',
          agent: ipv4Agent,
          lookup: (_host, _opts, cb) => cb(null, entry.address, 4),
          servername: hostname,
          timeout: RESPONSE_TIMEOUT_MS,
        });
        guardConnect(req);
        req.on('error', reject);
        req.on('response', (res) => {
          if ((res.statusCode || 0) >= 400) {
            res.resume();
            reject(new Error(`BITRIX24_HTTP_${res.statusCode}`));
            return;
          }
          resolve(res);
        });
        req.end();
      });
      lastGoodAddress = entry.address;
      return { status: response.statusCode || 200, headers: response.headers, stream: response };
    } catch (error) {
      if (isConnectFailure(error)) markDead(entry.address);
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('BITRIX24_REQUEST_FAILED');
}

export async function postBitrixJson(
  url: string,
  params: Record<string, string> | Record<string, unknown> | unknown[],
  sendJson = false,
  parallel = false,
): Promise<any> {
  const hostname = new URL(url).hostname;
  const pool = await resolveAddresses(hostname);
  // POST mutations are not idempotent: racing them across several Bitrix IPs
  // can create duplicate tasks, comments and time entries. Parallel probes are
  // therefore opt-in for known read-only callers only.
  const order = pickProbes(pool, pool.length);
  const groupSize = parallel || isReadMethod(url) ? MAX_PARALLEL : 1;
  const body = sendJson
    ? JSON.stringify(params)
    : new URLSearchParams(params as Record<string, string>).toString();

  const attempt = async (entry: AddressEntry) => {
    const attemptStart = Date.now();
    const { status, raw } = await httpRequest(url, body, sendJson, entry.address);
    if (Date.now() - attemptStart > SLOW_ADDRESS_MS) markDead(entry.address);
    if (status >= 500) throw new Error(`BITRIX24_HTTP_${status}`);
    return { entry, status, raw };
  };

  // Группу адресов гоняем наперегонки (для чтения) или по одному (для мутаций).
  // Если вся группа не смогла соединиться, берём следующую: раньше запрос
  // падал целиком, стоило выбору попасть на мёртвые адреса.
  const startedAt = Date.now();
  let lastError: unknown = new Error('BITRIX24_REQUEST_FAILED');
  for (let start = 0; start < order.length && start < groupSize * MAX_GROUPS; start += groupSize) {
    const group = order.slice(start, start + groupSize);
    if (!group.length) break;
    try {
      const winner = await Promise.any(group.map(attempt));
      lastGoodAddress = winner.entry.address;
      const elapsed = Date.now() - startedAt;
      if (elapsed > SLOW_CALL_MS) {
        // Без query: в нём auth-токен портала.
        const { hostname: host, pathname } = new URL(url);
        console.warn(
          `[bitrix] медленный запрос ${host}${pathname}: ${elapsed} мс, ответил ${winner.entry.address}, мёртвых адресов ${deadAddresses.size}`,
        );
      }
      try {
        return JSON.parse(winner.raw);
      } catch {
        throw new Error(`BITRIX24_INVALID_RESPONSE (${winner.status})`);
      }
    } catch (error) {
      const failures =
        error instanceof AggregateError ? error.errors : Array.isArray(error) ? error : [error];
      group.forEach((entry, index) => {
        if (isConnectFailure(failures[index] ?? failures[0])) markDead(entry.address);
      });
      lastError = failures[failures.length - 1] ?? error;
      // Сервер ответил (5xx, битый JSON) — адрес живой, повтор ничего не даст
      // и для мутации был бы опасен.
      if (!failures.every((failure) => isConnectFailure(failure))) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('BITRIX24_REQUEST_FAILED');
}

// Поллер задач стартует в src/instrumentation.ts, при старте сервера.
// Раньше он же запускался побочным эффектом импорта этого модуля: лишний
// путь запуска, который срабатывал только после первого запроса.

// Точки для тестов: перебор адресов — самая хрупкая часть общения с порталом.
export const __testing = {
  isConnectFailure,
  isReadMethod,
  markDead,
  pickProbes,
  reset: () => {
    deadAddresses.clear();
    lastGoodAddress = null;
  },
};
