import { describe, expect, it } from 'vitest';
import { source } from './helpers';

const server = source('server/index.ts');
const handler = source('server/websocket-handler.ts');

describe('WebSocket protocol', () => {
  it('[STRUCTURAL] supports the client lifecycle messages', () => {
    for (const type of ['start_call', 'end_call', 'barge_in']) expect(server).toContain(`case '${type}'`);
    for (const type of ['state', 'transcript', 'call_ended', 'nudge']) expect(server).toContain(`type: '${type}'`);
  });

  it('[STRUCTURAL] handles binary audio without parsing it as JSON', () => {
    expect(server).toContain('Buffer.isBuffer(data)');
    expect(server).toContain('sessionForWs.stt.sendAudio(data)');
    expect(handler).toContain('sendAudio(websocket: WebSocket, chunk: Buffer)');
  });

  it('[STRUCTURAL] marks barge-in responses and returns a call summary', () => {
    expect(server).toContain('text += \' [interrupted]\'');
    expect(server).toContain('generateSummary(this.transcript, durationSeconds)');
  });
});
