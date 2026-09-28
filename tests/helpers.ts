import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const projectRoot = resolve(__dirname, '..');

export function source(path: string): string {
  return readFileSync(resolve(projectRoot, path), 'utf8');
}

function normalizeValues(values: string[] | string, rest: string[]): string[] {
  return Array.isArray(values) ? values : [values, ...rest];
}

export function containsAny(text: string, values: string[] | string, ...rest: string[]): boolean {
  return normalizeValues(values, rest).some(value => text.includes(value));
}

export function doesNotContain(text: string, values: string[] | string, ...rest: string[]): boolean {
  return normalizeValues(values, rest).every(value => !text.includes(value));
}

export function isValidJSON(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

// Load server/.env into process.env so integration tests can use the same
// credentials the server does, without requiring a dotenv dependency.
function loadServerEnv(): void {
  try {
    const envPath = resolve(projectRoot, 'server', '.env');
    if (!existsSync(envPath)) return;
    for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (key in process.env) continue;
      const value = rawValue.replace(/^(["'])(.*)\1$/, '$2');
      process.env[key] = value;
    }
  } catch {
    // Best effort: tests fall back to skipped integration cases.
  }
}

loadServerEnv();

export function hasApiKey(): boolean {
  return Boolean(process.env.GROQ_API_KEY || process.env.GEMINI_API_KEY);
}

export async function createTestChatSession(): Promise<any> {
  if (!hasApiKey()) {
    throw new Error('An LLM API key is required for integration tests');
  }
  const { createChatSession } = await import('../server/services/llm');
  return createChatSession();
}

export function jsonMessages(values: unknown[]): Record<string, unknown>[] {
  return values
    .filter((value): value is string => typeof value === 'string')
    .map(value => JSON.parse(value) as Record<string, unknown>);
}
