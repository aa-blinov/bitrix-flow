import { lookup } from 'node:dns';
import { Agent, request } from 'node:https';

// Pin every REST call to IPv4. The Bitrix portal publishes several AAAA
// records that are silently unreachable from this server; Node's default
// Happy-Eyeballs selection then times out the TLS handshake for the whole
// request. Forcing IPv4 makes every call deterministic and fast.
const ipv4Agent = new Agent({ family: 4, keepAlive: true, maxSockets: 8 });

const CONNECT_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;
let addressCursor = 0;

// Some Bitrix24 portals return several A records. A single unavailable edge
// must not make the whole dashboard fail: select the next address per attempt.
function rotatingLookup(
  hostname: string,
  options: { all?: boolean },
  callback: (...args: any[]) => void,
) {
  lookup(hostname, { all: true, family: 4, verbatim: true }, (error, addresses) => {
    if (error || addresses.length === 0) {
      callback(error || new Error(`No IPv4 address for ${hostname}`));
      return;
    }
    const selected = addresses[addressCursor++ % addresses.length];
    // Node's https client asks for `all: true` on recent Node versions.
    // Its callback contract then expects an array of address records.
    if (options.all) callback(null, [selected]);
    else callback(null, selected.address, selected.family);
  });
}

export async function postBitrixJson(
  url: string,
  params: Record<string, string> | Record<string, unknown>,
  sendJson = false,
): Promise<any> {
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    try {
      return await new Promise((resolve, reject) => {
        const body = sendJson
          ? JSON.stringify(params)
          : new URLSearchParams(params as Record<string, string>).toString();
        const req = request(
          url,
          {
            method: 'POST',
            agent: ipv4Agent,
            lookup: rotatingLookup,
            timeout: CONNECT_TIMEOUT_MS,
            headers: {
              'Content-Type': sendJson ? 'application/json' : 'application/x-www-form-urlencoded',
              'Content-Length': Buffer.byteLength(body),
            },
          },
          (response) => {
            let raw = '';
            response.setEncoding('utf8');
            response.on('data', (chunk) => {
              raw += chunk;
            });
            response.on('end', () => {
              try {
                resolve(JSON.parse(raw));
              } catch {
                reject(new Error(`BITRIX24_INVALID_RESPONSE (${response.statusCode || 0})`));
              }
            });
          },
        );

        req.on('timeout', () => req.destroy(new Error('BITRIX24_CONNECT_TIMEOUT')));
        req.on('error', reject);
        req.end(body);
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('BITRIX24_REQUEST_FAILED');
}


// Запускаем фоновый поллер задач сразу при первом импорте —
// модуль-синглтон (через globalThis), стартует ровно один раз.
import { startBackgroundSync } from "./background-sync";
startBackgroundSync();
