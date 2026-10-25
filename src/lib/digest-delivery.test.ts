import nodemailer from 'nodemailer';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deliverDigest, digestChannels, toPlainText } from './digest-delivery';

afterEach(() => vi.restoreAllMocks());

const noBitrix = async () => {};

describe('digest channels', () => {
  it('are all off without keys and turn on one by one', () => {
    expect(digestChannels({}, noBitrix)).toEqual([]);
    const names = (env: Record<string, string>) =>
      digestChannels(env, noBitrix).map((channel) => channel.name);
    expect(names({ DIGEST_DIALOG_ID: '9' })).toEqual(['bitrix']);
    expect(names({ TELEGRAM_BOT_TOKEN: 't' })).toEqual([]);
    expect(names({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_CHAT_ID: '1' })).toEqual(['telegram']);
    // Открытый http для вебхука не включается.
    expect(names({ DIGEST_WEBHOOK_URL: 'http://example.com/h' })).toEqual([]);
    expect(names({ DIGEST_WEBHOOK_URL: 'https://example.com/h' })).toEqual(['webhook']);
    expect(
      names({ SMTP_URL: 'smtp://x', DIGEST_EMAIL_TO: 'a@b.c', DIGEST_EMAIL_FROM: 'f@b.c' }),
    ).toEqual(['email']);
  });

  it('strips Bitrix tags and keeps line breaks', () => {
    expect(toPlainText('[B]Сводка[/B]\nПросрочено 3')).toBe('Сводка\nПросрочено 3');
  });

  it('sends to Telegram as plain text with the bot token in the URL only', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}'));
    const [channel] = digestChannels(
      { TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_CHAT_ID: '77' },
      noBitrix,
    );
    await channel.send('[B]Сводка[/B]');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.telegram.org/bottok/sendMessage');
    expect(JSON.parse(String(init?.body))).toEqual({
      chat_id: '77',
      text: 'Сводка',
      disable_web_page_preview: true,
    });
  });

  it('sends an email through the given transport', async () => {
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const createTransport = vi.fn().mockReturnValue(transport);
    const sendMail = vi.spyOn(transport, 'sendMail');
    const [channel] = digestChannels(
      { SMTP_URL: 'smtp://u:p@h', DIGEST_EMAIL_TO: 'boss@x.ru', DIGEST_EMAIL_FROM: 'bot@x.ru' },
      noBitrix,
      createTransport as unknown as typeof nodemailer.createTransport,
    );
    await channel.send('[B]Сводка[/B]');
    expect(createTransport).toHaveBeenCalledWith('smtp://u:p@h');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'boss@x.ru', from: 'bot@x.ru', text: 'Сводка' }),
    );
  });

  it('keeps going when one channel fails and reports it', async () => {
    const results = await deliverDigest(
      [
        { name: 'telegram', send: async () => Promise.reject(new Error('telegram: HTTP 401')) },
        { name: 'webhook', send: async () => {} },
      ],
      'текст',
    );
    expect(results).toEqual([
      { channel: 'telegram', ok: false, error: 'telegram: HTTP 401' },
      { channel: 'webhook', ok: true, error: undefined },
    ]);
  });
});
