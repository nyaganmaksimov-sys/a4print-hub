import 'dotenv/config';

const installed = Symbol.for('a4print.jarvis.cloud_response_guard.installed');

if (!globalThis[installed]) {
  globalThis[installed] = true;
  const originalFetch = globalThis.fetch.bind(globalThis);
  const workshopUrl = String(process.env.JARVIS_WORKSHOP_URL || '').replace(/\/$/, '');
  const cloudTasks = new Set([
    'incident_analysis',
    'support_self_service',
    'support_reply',
    'support_research',
    'message_draft'
  ]);

  globalThis.fetch = async function guardedJarvisCloudFetch(input, init = {}) {
    const response = await originalFetch(input, init);
    try {
      const url = typeof input === 'string' || input instanceof URL ? String(input) : String(input?.url || '');
      if (!workshopUrl || !url.startsWith(`${workshopUrl}/api/v1/assistant/query`)) return response;
      if (String(init?.method || 'GET').toUpperCase() !== 'POST') return response;

      let requestBody = null;
      try {
        if (typeof init?.body === 'string') requestBody = JSON.parse(init.body);
      } catch {}
      const task = String(requestBody?.context?.task || '');
      if (!cloudTasks.has(task)) return response;
      if (!response.ok) return response;

      const clone = response.clone();
      const body = await clone.json().catch(() => null);
      const data = body?.data && typeof body.data === 'object' ? body.data : {};
      const llmErrors = Array.isArray(data.llm_errors) ? data.llm_errors.filter(Boolean) : [];
      const provider = String(data.provider || '').trim();
      const text = String(body?.text || '');
      const looksLikeFallback = /облачн(?:ый|ого) мозг.*недоступ|языковая модель сейчас недоступна/i.test(text);

      if (!llmErrors.length && provider && !looksLikeFallback) return response;

      const error = {
        success: false,
        error: 'CLOUD_LLM_UNAVAILABLE',
        task,
        llm_errors: llmErrors.slice(0, 5)
      };
      console.warn('[Jarvis Cloud Guard]', task, llmErrors.join(',') || 'provider_missing_or_fallback');
      return new Response(JSON.stringify(error), {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
      });
    } catch (error) {
      console.warn('[Jarvis Cloud Guard] inspection failed:', error?.message || error);
      return response;
    }
  };
}
