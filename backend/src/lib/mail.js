import { config } from '../config.js';

// Placeholder mail sender. This project does not ship an SMTP integration.
// In development the reset link is printed to the server console so you can test the flow.
// In tests the messages are collected in memory so tests can read them.
export const outbox = [];

export async function sendMail({ to, subject, text }) {
  if (config.isTest) {
    outbox.push({ to, subject, text });
    return;
  }
  if (config.isProd) {
    console.warn('[mail] no mail provider configured; message not sent');
    return;
  }
  console.log(`[mail:dev] To: ${to}\n  Subject: ${subject}\n  ${text}`);
}
