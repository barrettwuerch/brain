import PQueue from 'p-queue';

export function makeApiQueue({ concurrency = 10 }) {
  const q = new PQueue({ concurrency });
  return q;
}

export async function withRetryAfter(queue, fn, { logger } = {}) {
  try {
    return await queue.add(fn);
  } catch (e) {
    // If upstream threw an error with retryAfterMs, pause and retry once.
    const ra = e?.retryAfterMs;
    if (ra && Number.isFinite(ra) && ra > 0) {
      logger?.warn({ retryAfterMs: ra }, 'rate limited; pausing queue');
      queue.pause();
      await new Promise(r => setTimeout(r, ra));
      queue.start();
      return await queue.add(fn);
    }
    throw e;
  }
}
