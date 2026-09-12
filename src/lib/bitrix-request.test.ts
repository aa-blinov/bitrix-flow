import { describe, expect, it } from 'vitest';
import { __testing } from './bitrix-request';

describe('isConnectFailure', () => {
  it('таймаут соединения — повторяемая ошибка', () => {
    expect(__testing.isConnectFailure(new Error('BITRIX24_CONNECT_TIMEOUT'))).toBe(true);
    const refused = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    expect(__testing.isConnectFailure(refused)).toBe(true);
  });

  it('ответ сервера повторять нельзя', () => {
    expect(__testing.isConnectFailure(new Error('BITRIX24_HTTP_502'))).toBe(false);
    expect(__testing.isConnectFailure(new Error('BITRIX24_INVALID_RESPONSE (200)'))).toBe(false);
  });
});

describe('мёртвые адреса', () => {
  it('помеченный адрес выпадает из выбора, пока не истечёт срок', () => {
    const pool = [
      { address: '1.1.1.1', family: 4 },
      { address: '2.2.2.2', family: 4 },
    ];
    __testing.markDead('1.1.1.1');
    expect(__testing.pickProbes(pool, 2).map((entry) => entry.address)).toEqual(['2.2.2.2']);
    __testing.reset();
    expect(__testing.pickProbes(pool, 2).length).toBe(2);
  });

  it('если живых не осталось, пробуем всё равно', () => {
    const pool = [{ address: '1.1.1.1', family: 4 }];
    __testing.markDead('1.1.1.1');
    expect(__testing.pickProbes(pool, 1).map((entry) => entry.address)).toEqual(['1.1.1.1']);
    __testing.reset();
  });
});
