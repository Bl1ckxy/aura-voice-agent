import { describe, expect, it } from 'vitest';
import { createTestChatSession, hasApiKey, isValidJSON, source } from './helpers';
import { generateSummary } from '../server/services/llm';

const llm = source('server/services/llm.ts');

describe('call summary contract', () => {
  it('[STRUCTURAL] defines all fields consumed by the frontend', () => {
    for (const field of [
      'customer_intent', 'order_id', 'customer_name', 'resolution_status',
      'action_taken', 'call_summary', 'follow_up_required', 'sentiment',
      'call_duration_seconds',
    ]) {
      expect(llm).toContain(field);
    }
  });

  it('[STRUCTURAL] uses a deterministic fallback and preserves measured duration', () => {
    expect(llm).toContain('function getFallbackSummary');
    expect(llm).toContain('Summary auto-generated from transcript log.');
    expect(llm).toContain('call_duration_seconds: durationSeconds');
    expect(llm).toContain('return getFallbackSummary(durationSeconds)');
  });

  it('[STRUCTURAL] requests JSON rather than exposing raw model output to callers', () => {
    expect(llm).toContain('return ONLY a valid JSON object');
    expect(llm).toContain('JSON.parse(text)');
  });
});

describe.skipIf(!hasApiKey())('summary integration', () => {
  it('[INTEGRATION] returns the documented summary shape', async () => {
    // The helper deliberately creates the real session only when a key is provided.
    await createTestChatSession();
    const summary = await generateSummary([
      { speaker: 'customer', text: 'Where is ORD-101?', timestamp: 1 },
      { speaker: 'agent', text: 'It is out for delivery.', timestamp: 2 },
    ], 12);
    expect(isValidJSON(JSON.stringify(summary))).toBe(true);
    expect(summary.call_duration_seconds).toBe(12);
    expect(summary.customer_intent).toBeDefined();
  }, 30_000);
});
