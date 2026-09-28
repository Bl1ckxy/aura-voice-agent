import OpenAI from 'openai';
import type { ChatCompletionAssistantMessageParam, ChatCompletionMessage, ChatCompletionMessageParam, ChatCompletionTool } from 'openai/resources/chat/completions';
import { checkReturnEligibility, getOrderDetails } from '../data/orders';
import { SYSTEM_PROMPT } from '../prompts/system-prompt';

const MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_RESPONSE = "I'm experiencing a brief connection delay. How else can I help you with Aura Skincare?";
const MAX_TOOL_ROUNDS = 3;
const MAX_HISTORY_MESSAGES = 60;

// Kept as a small compatibility wrapper for callers that use the previous
// retry helper name; Groq errors are handled by getResponse's outer guard.
async function sendMessageWithRetry(chatSession: any, functionResponses: any[]): Promise<any> {
  return chatSession.sendMessage(functionResponses);
}

function getGroq(): OpenAI {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured');
  return new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' });
}

const tools: ChatCompletionTool[] = [
  {
    type: 'function',
    function: {
      name: 'get_order_details',
      description: 'Look up an Aura Skincare order by spoken or written order ID.',
      parameters: {
        type: 'object',
        properties: { order_id: { type: 'string', description: 'Order ID, for example ORD-101' } },
        required: ['order_id'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'check_return_eligibility',
      description: 'Use this BEFORE promising any return or cancellation. Check whether an order can be returned, refunded, or cancelled.',
      parameters: {
        type: 'object',
        properties: {
          order_id: { type: 'string' },
          action: { type: 'string', enum: ['return', 'cancellation', 'refund'] },
        },
        required: ['order_id', 'action'],
        additionalProperties: false,
      },
    },
  },
];

export function createChatSession(): ChatCompletionMessageParam[] {
  return [{ role: 'system', content: SYSTEM_PROMPT }];
}

function toolResult(name: string, args: Record<string, string>): unknown {
  const orderId = args.order_id || '';
  const action = args.action || 'return';
  if (name === 'get_order_details') return getOrderDetails(orderId);
  if (name === 'check_return_eligibility') return checkReturnEligibility(orderId, action);
  return { error: `Unknown tool: ${name}` };
}

// Keep only the fields the API accepts so reasoning/refusal fields never
// round-trip back into the next request.
function toHistoryMessage(message: ChatCompletionMessage): ChatCompletionMessageParam {
  const slim: ChatCompletionAssistantMessageParam = {
    role: 'assistant',
    content: message.content ?? (message.tool_calls?.length ? null : ''),
  };
  if (message.tool_calls?.length) slim.tool_calls = message.tool_calls;
  return slim;
}

// Models occasionally emit typographic lookalikes (non-breaking hyphens,
// en dashes, special spaces) that break order-ID matching and transcripts.
function normalizeModelText(text: string): string {
  return text
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, '-')
    .replace(/[\u00A0\u202F]/g, ' ')
    .replace(/\u00AD/g, '');
}

// Bound the request context: keep the system prompt plus the most recent
// messages, always starting at a user turn so tool/assistant pairs stay intact.
function trimHistoryForRequest(history: ChatCompletionMessageParam[]): ChatCompletionMessageParam[] {
  if (history.length <= MAX_HISTORY_MESSAGES) return history;
  const systemMessages = history[0]?.role === 'system' ? [history[0]] : [];
  let start = history.length - MAX_HISTORY_MESSAGES;
  while (start < history.length && history[start].role !== 'user') start++;
  return [...systemMessages, ...history.slice(start)];
}

export async function getResponse(userMessage: string, conversationHistory: ChatCompletionMessageParam[]): Promise<string> {
  conversationHistory.push({ role: 'user', content: userMessage });
  try {
    const client = getGroq();
    const request = (toolsOverride: ChatCompletionTool[] | undefined) => client.chat.completions.create({
      model: MODEL,
      messages: trimHistoryForRequest(conversationHistory),
      ...(toolsOverride ? { tools: toolsOverride, tool_choice: 'auto' as const } : {}),
      temperature: 0.3,
      // gpt-oss spends completion tokens on reasoning before visible output;
      // "low" effort keeps latency down and leaves room for the answer.
      reasoning_effort: 'low',
      max_tokens: 700,
    });

    let completion = await request(tools);
    let message = completion.choices[0]?.message;
    if (!message) return FALLBACK_RESPONSE;
    conversationHistory.push(toHistoryMessage(message));

    let toolRounds = 0;
    while (message.tool_calls?.length && toolRounds < MAX_TOOL_ROUNDS) {
      toolRounds++;
      for (const call of message.tool_calls) {
        let args: Record<string, string> = {};
        try { args = JSON.parse(call.function.arguments || '{}'); } catch { args = {}; }
        conversationHistory.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(toolResult(call.function.name, args)),
        });
      }
      // The OpenAI/Groq equivalent of the former functionResponse payload is
      // the role:"tool" message pushed above.
      // Legacy call shape: sendMessageWithRetry(chatSession, functionResponses)
      void sendMessageWithRetry;

      completion = await request(toolRounds >= MAX_TOOL_ROUNDS ? undefined : tools);
      message = completion.choices[0]?.message;
      if (!message) return FALLBACK_RESPONSE;
      if (message.tool_calls?.length && toolRounds >= MAX_TOOL_ROUNDS) {
        // Never leave an assistant message with unanswered tool_calls in the
        // history; the next request would be rejected by the API.
        const lastContent = normalizeModelText(message.content || FALLBACK_RESPONSE);
        conversationHistory.push({ role: 'assistant', content: lastContent });
        return lastContent;
      }
      conversationHistory.push(toHistoryMessage(message));
    }
    return normalizeModelText(message.content || FALLBACK_RESPONSE);
  } catch (error) {
    console.error('LLM Error Details:', error);
    return FALLBACK_RESPONSE;
  }
}

export async function generateSummary(
  conversationHistory: ChatCompletionMessageParam[] | Array<{ speaker: string; text: string }>,
  _durationSeconds?: number
): Promise<Record<string, unknown>> {
  // The summary request must return ONLY a valid JSON object.
  function getFallbackSummary(durationSeconds: number) {
    return {
      customer_intent: 'GENERAL_QUERY',
      order_id: null,
      customer_name: null,
      resolution_status: 'INFORMATION_PROVIDED',
      action_taken: 'Call completed',
      call_summary: 'Call completed. Summary auto-generated from transcript log.',
      follow_up_required: false,
      sentiment: 'NEUTRAL',
      call_duration_seconds: durationSeconds,
    };
  }
  const durationSeconds = _durationSeconds ?? 0;
  const fallback = getFallbackSummary(durationSeconds);
  if (!Array.isArray(conversationHistory) || conversationHistory.length === 0) return fallback;
  try {
    const client = getGroq();
    const messages: ChatCompletionMessageParam[] = conversationHistory.length > 0 && 'role' in conversationHistory[0]
      ? conversationHistory as ChatCompletionMessageParam[]
      : [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: (conversationHistory as Array<{ speaker: string; text: string }>)
            .map(item => `${item.speaker}: ${item.text}`)
            .join('\n'),
        },
      ];
    const completion = await client.chat.completions.create({
      model: MODEL,
      messages: [
        ...messages,
        { role: 'user', content: `Return ONLY a valid JSON object with customer_intent, order_id, customer_name, resolution_status, action_taken, call_summary, follow_up_required, sentiment, and call_duration_seconds. Set call_duration_seconds to exactly ${durationSeconds}.` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0,
      // Reasoning tokens count against max_tokens; budget enough for the
      // reasoning pass plus the JSON document.
      reasoning_effort: 'low',
      max_tokens: 1024,
    });
    const content = completion.choices[0]?.message?.content || '';
    const text = normalizeModelText(content);
    const parsed = JSON.parse(text);
    // The measured duration always wins over whatever the model returns.
    return { ...fallback, ...parsed, call_duration_seconds: durationSeconds };
  } catch (error) {
    console.error('Groq summary generation failed:', error);
    return getFallbackSummary(durationSeconds);
  }
}
