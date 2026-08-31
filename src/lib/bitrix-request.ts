import { lookup } from 'node:dns';
import { Agent, request } from 'node:https';

// Pin every REST call to IPv4. The Bitrix portal publishes several AAAA
// records that are silently unreachable from this server; Node's default
// Happy-Eyeballs selection then times out the TLS handshake for the whole
// request. Forcing IPv4 makes every call deterministic and fast.
const ipv4Agent = new Agent({ family: 4, keepAlive: true, maxSockets: 8 });

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_PARALLEL = 3;

// Some Bitrix24 portals return several A records. We probe a handful in
// parallel and take the first to answer — a single dead edge (and they
// exist, see eora.bitrix24.ru: 46.235.53.67 / .70 hang on TCP connect)
// must not stall the whole call for the full timeout, three times in a row.
// lastGoodAddress biases the next attempt to the address that just answered.
let lastGoodAddress: string | null = null;

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
  const rest = pool.filter((a) => a.address !== lastGoodAddress);
  for (let i = rest.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const head = lastGoodAddress ? pool.filter((a) => a.address === lastGoodAddress) : [];
  return [...head, ...rest].slice(0, n);
}

function httpRequest(
  url: string,
  body: string,
  sendJson: boolean,
  timeoutMs: number,
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
      timeout: timeoutMs,
      headers: {
        'Content-Type': sendJson ? 'application/json' : 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    });
    req.on('timeout', () => req.destroy(new Error('BITRIX24_CONNECT_TIMEOUT')));
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

export async function postBitrixJson(
  url: string,
  params: Record<string, string> | Record<string, unknown>,
  sendJson = false,
): Promise<any> {
  const hostname = new URL(url).hostname;
  const pool = await resolveAddresses(hostname);
  const probes = pickProbes(pool, MAX_PARALLEL);
  const body = sendJson
    ? JSON.stringify(params)
    : new URLSearchParams(params as Record<string, string>).toString();

  // Race a handful of addresses against the same timeout. First success wins;
  // the rest are torn down by abort. AnyConnect error or 5xx from a probe is
  // ignored unless EVERY probe fails, in which case we report a timeout.
  const attempts = probes.map(async (entry) => {
    try {
      const { status, raw } = await httpRequest(
        url,
        body,
        sendJson,
        CONNECT_TIMEOUT_MS,
        entry.address,
      );
      if (status >= 500) throw new Error(`BITRIX24_HTTP_${status}`);
      return { entry, status, raw };
    } catch (error) {
      throw error;
    }
  });

  try {
    const winner = await Promise.any(attempts);
    lastGoodAddress = winner.entry.address;
    try {
      return JSON.parse(winner.raw);
    } catch {
      throw new Error(`BITRIX24_INVALID_RESPONSE (${winner.status})`);
    }
  } catch (errors) {
    const list = Array.isArray(errors) ? errors : [errors];
    const last = list[list.length - 1];
    throw last instanceof Error ? last : new Error('BITRIX24_REQUEST_FAILED');
  }
}

// Запускаем фоновый поллер задач сразу при первом импорте —
// модуль-синглтон (через globalThis), стартует ровно один раз.
import { startBackgroundSync } from './background-sync';
startBackgroundSync();
