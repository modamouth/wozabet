import { AppError } from './errors';
import { log } from './log';

export interface SmsSender { name: string; send(toE164: string, text: string): Promise<void> }

/** Dev only: prints the message to the server log. Refused in production. */
export function consoleSms(): SmsSender {
  // dev only (refused in production). Kept as plain text so the code is easy to read in the terminal.
  return { name: 'console', async send(to, text) { log.debug('sms (dev console)', { to: to.slice(0, 7) + '…' }); console.log(`[sms:dev] to ${to}: ${text}`); } };
}

/** Twilio Programmable Messaging (supports Namibian numbers). */
export function twilioSms(cfg: { accountSid: string; authToken: string; from: string; fetchImpl?: typeof fetch }): SmsSender {
  const f = cfg.fetchImpl ?? fetch;
  return {
    name: 'twilio',
    async send(to, text) {
      const res = await f(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.accountSid)}/Messages.json`, {
        method: 'POST',
        headers: { authorization: 'Basic ' + Buffer.from(`${cfg.accountSid}:${cfg.authToken}`).toString('base64'), 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ To: to, From: cfg.from, Body: text }).toString(),
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) throw new Error(`SMS provider returned HTTP ${res.status}`);
    },
  };
}

export function getSmsSender(env: Record<string, string | undefined> = process.env): SmsSender {
  const which = env.SMS_PROVIDER || (env.NODE_ENV === 'production' ? '' : 'console');
  if (which === 'console') {
    if (env.NODE_ENV === 'production') throw new AppError('sms_misconfigured', 'SMS is not configured', 503);
    return consoleSms();
  }
  if (which === 'twilio') {
    const { TWILIO_ACCOUNT_SID: accountSid = '', TWILIO_AUTH_TOKEN: authToken = '', SMS_FROM: from = '' } = env;
    if (!accountSid || !authToken || !from) throw new AppError('sms_misconfigured', 'SMS is not configured', 503);
    return twilioSms({ accountSid, authToken, from });
  }
  throw new AppError('sms_misconfigured', 'SMS is not configured (set SMS_PROVIDER)', 503);
}
