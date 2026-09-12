import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { incidentNeedsAnalysis } from '../src/jarvis-support-ai.js';

const incident = {
  id: 'incident-1',
  kind: 'integration_error',
  severity: 'HIGH',
  source: 'moysklad',
  title: 'Интеграция недоступна',
  detail: 'HTTP 503',
  evidence: { status: 503 }
};

const now = Date.parse('2026-09-12T12:00:00.000Z');
const retryMs = 30 * 60 * 1000;
const signature = createHash('sha256').update(JSON.stringify({
  kind: incident.kind,
  severity: incident.severity,
  source: incident.source,
  title: incident.title,
  detail: incident.detail,
  evidence: incident.evidence
})).digest('hex');

function matchingCache(overrides = {}) {
  return {
    incident_signature: signature,
    analysis: '',
    last_error: 'CLOUD_LLM_UNAVAILABLE',
    updated_at: '2026-09-12T11:50:00.000Z',
    ...overrides
  };
}

test('failed unchanged incident waits for retry cooldown', () => {
  const cached = matchingCache();

  assert.equal(incidentNeedsAnalysis(incident, cached, now, retryMs), false);
  assert.equal(incidentNeedsAnalysis(incident, cached, now + 20 * 60 * 1000, retryMs), true);
});

test('new, changed, and never-attempted incidents remain immediately eligible', () => {
  assert.equal(incidentNeedsAnalysis(incident, null, now, retryMs), true);
  assert.equal(incidentNeedsAnalysis(incident, matchingCache({ incident_signature: 'changed' }), now, retryMs), true);
  assert.equal(incidentNeedsAnalysis(incident, matchingCache({ incident_signature: signature, last_error: null }), now, retryMs), true);
  assert.equal(incidentNeedsAnalysis(incident, matchingCache({ incident_signature: signature, analysis: 'Готовый анализ' }), now, retryMs), false);
});
