import { describe, expect, it } from 'vitest';
import { source } from './helpers';

const prompt = source('server/prompts/system-prompt.ts');
const llm = source('server/services/llm.ts');

describe('LLM guardrails', () => {
  it('[STRUCTURAL] keeps the assistant in the Aura support domain', () => {
    expect(prompt).toContain('ONLY answer Aura Skincare questions');
    expect(prompt).toContain('Decline unrelated requests politely');
    expect(prompt).toContain('Keep responses SHORT');
  });

  it('[STRUCTURAL] documents policy boundaries and ambiguity handling', () => {
    expect(prompt).toContain('Within 7 days');
    expect(prompt).toContain('Only if status is "Processing"');
    expect(prompt).toContain('ask ONE clarifying question');
    expect(prompt).toContain('support@auraskincare.in');
  });

  it('[STRUCTURAL] requires eligibility checks before return or cancellation claims', () => {
    expect(prompt).toContain('ALWAYS use check_return_eligibility');
    expect(llm).toContain("name: 'check_return_eligibility'");
    expect(llm).toContain('Use this BEFORE promising any return or cancellation');
  });
});
