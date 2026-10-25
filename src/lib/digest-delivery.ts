// Куда уходит недельная сводка. Каналы включаются переменными окружения и по умолчанию
// выключены: чат Битрикса (DIGEST_DIALOG_ID), Telegram, любой вебхук (Slack, Mattermost,
// n8n, почтовые шлюзы) и обычная почта по SMTP. Ключи лежат только в .env.local.

import nodemailer from 'nodemailer';

export type DeliveryChannel = {
  name: 'bitrix' | 'telegram' | 'webhook' | 'email';
  send: (text: string) => Promise<void>;
};

type Env = Record<string, string | undefined>;

// Теги Битрикса в Telegram и почте были бы видны как есть: оставляем текст с переносами.
export function toPlainText(text: string): string {
  return text.replace(/\[\/?[a-z]+(?:=[^\]]*)?\]/gi, '');
}

async function post(url: string, body: unknown, label: string) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`${label}: HTTP ${response.status}`);
}

export function digestChannels(
  env: Env,
  bitrixSend: (text: string) => Promise<void>,
  createTransport: typeof nodemailer.createTransport = nodemailer.createTransport,
): DeliveryChannel[] {
  const channels: DeliveryChannel[] = [];
  if (env.DIGEST_DIALOG_ID) channels.push({ name: 'bitrix', send: bitrixSend });

  if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID)
    channels.push({
      name: 'telegram',
      send: (text) =>
        post(
          `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
          {
            chat_id: env.TELEGRAM_CHAT_ID,
            text: toPlainText(text),
            disable_web_page_preview: true,
          },
          'telegram',
        ),
    });

  // Вебхук только по https: сводка уходит наружу, и открытый http отдал бы её по пути.
  if (env.DIGEST_WEBHOOK_URL?.startsWith('https://'))
    channels.push({
      name: 'webhook',
      send: (text) => post(env.DIGEST_WEBHOOK_URL!, { text: toPlainText(text) }, 'webhook'),
    });

  if (env.SMTP_URL && env.DIGEST_EMAIL_TO && env.DIGEST_EMAIL_FROM)
    channels.push({
      name: 'email',
      send: async (text) => {
        const transport = createTransport(env.SMTP_URL!);
        await transport.sendMail({
          from: env.DIGEST_EMAIL_FROM,
          to: env.DIGEST_EMAIL_TO,
          subject: 'Сводка BitrixFlow',
          text: toPlainText(text),
        });
      },
    });
  return channels;
}

export async function deliverDigest(channels: DeliveryChannel[], text: string) {
  // Сбой одного канала не должен глушить остальные.
  const results = await Promise.allSettled(channels.map((channel) => channel.send(text)));
  return channels.map((channel, index) => {
    const result = results[index];
    return {
      channel: channel.name,
      ok: result.status === 'fulfilled',
      error:
        result.status === 'rejected'
          ? result.reason instanceof Error
            ? result.reason.message
            : String(result.reason)
          : undefined,
    };
  });
}
