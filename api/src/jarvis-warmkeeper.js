import 'dotenv/config';

const installed = Symbol.for('a4print.jarvis.warmkeeper.installed');

if (!globalThis[installed]) {
  globalThis[installed] = true;

  const jarvisUrl = String(process.env.JARVIS_WORKSHOP_URL || '').replace(/\/$/, '');
  const jarvisKey = String(process.env.JARVIS_API_KEY || '');
  const intervalMs = Math.max(4 * 60_000, Number(process.env.JARVIS_WARMKEEPER_INTERVAL_MS || 7 * 60_000));
  const state = {
    last_attempt_at: null,
    last_ok_at: null,
    last_error_at: null,
    last_error: null,
    last_status: null,
    attempts: 0,
    successes: 0
  };

  async function ping() {
    if (!jarvisUrl || !jarvisKey) return;
    state.last_attempt_at = new Date().toISOString();
    state.attempts += 1;
    try {
      const response = await fetch(`${jarvisUrl}/health`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${jarvisKey}`, Accept: 'application/json' },
        cache: 'no-store'
      });
      state.last_status = response.status;
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      await response.arrayBuffer().catch(() => {});
      state.last_ok_at = new Date().toISOString();
      state.last_error = null;
      state.successes += 1;
    } catch (error) {
      state.last_error_at = new Date().toISOString();
      state.last_error = String(error?.message || error);
      console.warn('[Jarvis warmkeeper]', state.last_error);
    }
  }

  if (jarvisUrl && jarvisKey) {
    const first = setTimeout(ping, 25_000);
    first.unref?.();
    const timer = setInterval(ping, intervalMs);
    timer.unref?.();
  }

  globalThis.__A4_JARVIS_WARMKEEPER_STATS__ = state;
}
