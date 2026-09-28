import { describe, expect, it } from 'vitest';
import { createTestChatSession, hasApiKey, source } from './helpers';
import { getResponse } from '../server/services/llm';

const llm = source('server/services/llm.ts');

describe('LLM tool calling contract', () => {
  it('[STRUCTURAL] declares both order tools with required arguments', () => {
    expect(llm).toContain("name: 'get_order_details'");
    expect(llm).toContain("name: 'check_return_eligibility'");
    expect(llm).toMatch(/required:\s*\['order_id'\]/);
    expect(llm).toMatch(/enum:\s*\['return', 'cancellation', 'refund'\]/);
  });

  it('[STRUCTURAL] executes tool results and sends them back to the chat', () => {
    expect(llm).toContain('getOrderDetails(orderId)');
    expect(llm).toContain('checkReturnEligibility(orderId, action)');
    expect(llm).toContain('functionResponse');
    expect(llm).toContain('sendMessageWithRetry(chatSession, functionResponses)');
  });
});

describe.skipIf(!hasApiKey())('LLM tool-calling integration', () => {
  it('[INTEGRATION] answers an order lookup without exposing credentials', async () => {
    const chat = await createTestChatSession();
    const response = await getResponse('Where is order ORD-101?', chat);
    expect(response).toContain('ORD-101');
    expect(response).not.toContain(process.env.GROQ_API_KEY!);
  }, 30_000);
});
