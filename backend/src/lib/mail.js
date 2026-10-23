import { config } from '../config.js';

// Outgoing email. In production it sends through the Brevo HTTPS API (BREVO_API_KEY + MAIL_FROM).
// Without a key the message is printed to the server console (development) so flows can still be tested.
// In tests the messages are collected in memory so tests can read them.
export const outbox = [];

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Returns true when the message was handed to the provider. Never throws: a mail problem must not
// break registration or recovery, and the user can always ask for another message.
export async function sendMail({ to, subject, text }) {
  if (config.isTest) {
    outbox.push({ to, subject, text });
    return true;
  }
  if (!config.brevoApiKey || !config.mailFrom) {
    if (config.isProd) console.warn('[mail] BREVO_API_KEY / MAIL_FROM not set; message not sent');
    else console.log(`[mail:dev] To: ${to}\n  Subject: ${subject}\n  ${text}`);
    return false;
  }
  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': config.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: config.mailFrom, name: config.mailFromName },
        to: [{ email: to }],
        subject,
        textContent: text,
        htmlContent: `<p style="font-family:sans-serif;line-height:1.5">${escapeHtml(text).replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')}</p>`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.error(`[mail] provider rejected the message (${res.status}): ${(await res.text()).slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error('[mail] could not reach the mail provider:', err.message);
    return false;
  }
}
