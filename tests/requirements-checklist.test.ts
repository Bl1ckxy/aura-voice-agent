import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { containsAny, doesNotContain, isValidJSON, projectRoot, source } from './helpers';

describe('self-test requirements checklist', () => {
  it('[STRUCTURAL] has the requested test modules and Vitest configuration', () => {
    for (const file of [
      'tests/helpers.ts', 'tests/tools.test.ts', 'tests/llm-guardrails.test.ts',
      'tests/tool-calling.test.ts', 'tests/summary.test.ts',
      'tests/websocket-protocol.test.ts', 'tests/requirements-checklist.test.ts',
      'vitest.config.ts',
    ]) expect(existsSync(resolve(projectRoot, file))).toBe(true);
  });

  it('[STRUCTURAL] keeps secrets out of the test suite', () => {
    expect(source('tests/helpers.ts')).not.toMatch(/AIza|sk-[A-Za-z0-9]/);
  });

  it('[UNIT] exposes reusable content and JSON assertions', () => {
    expect(containsAny('Aura order support', ['order', 'return'])).toBe(true);
    expect(doesNotContain('Aura order support', ['flight', 'weather'])).toBe(true);
    expect(isValidJSON('{"ok":true}')).toBe(true);
    expect(isValidJSON('not json')).toBe(false);
  });
});
