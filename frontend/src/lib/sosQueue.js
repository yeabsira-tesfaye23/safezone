import { ApiError, post } from './api.js';

// If the internet is down when SOS is pressed, the alert is kept on this device and retried.
// It is NEVER shown as sent until the server has confirmed it.
const KEY = 'sz_sos_queue';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; } };
const write = (q) => { try { localStorage.setItem(KEY, JSON.stringify(q)); } catch { /* storage unavailable */ } };

export const queuedCount = () => read().length;
export const enqueue = (item) => write([...read().filter((i) => i.clientId !== item.clientId), item]);

export async function sendSos(item) {
  const result = await post('/sos', item);
  write(read().filter((i) => i.clientId !== item.clientId));
  return result;
}

// Try every queued alert. Returns the results of those that reached the server.
export async function flushQueue() {
  const delivered = [];
  for (const item of read()) {
    try {
      delivered.push(await sendSos(item));
    } catch (err) {
      if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 429) {
        write(read().filter((i) => i.clientId !== item.clientId)); // the server rejected it for good
      } else break; // still offline; try again later
    }
  }
  return delivered;
}
