import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import dotenv from 'dotenv';
import cors from 'cors';
import { getOrderDetails } from './data/orders';
import { SYSTEM_PROMPT } from './prompts/system-prompt';
import { createChatSession, getResponse, generateSummary } from './services/llm';
import { DeepgramSTT } from './services/stt';
import { textToSpeech } from './services/tts';

dotenv.config();

const app = express();
const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

app.get('/', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'aura-voice-agent' });
});

app.get('/api/self-test', (_req, res) => {
  res.json({ status: 'ok', groqConfigured: Boolean(process.env.GROQ_API_KEY), deepgramConfigured: Boolean(process.env.DEEPGRAM_API_KEY) });
});

app.get('/system-prompt', (_req, res) => {
  res.json({ prompt: SYSTEM_PROMPT });
});

const SILENCE_TIMEOUT_MS = 8000;
const MAX_NUDGES_PER_CALL = 2;
const NUDGE_MESSAGE = "Are you still there? I'm here to help with any Aura Skincare questions.";
const FALLBACK_PHRASES = [
  'high demand',
  'experiencing high demand',
  'technical difficulties',
  'experiencing technical difficulties',
  'brief connection delay',
  'connection delay',
  'how else can i help you with aura skincare',
];

function safeSend(ws: WebSocket | null, payload: string | Buffer): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    ws.send(payload);
  } catch (error) {
    console.error('Failed to send message to client:', error);
  }
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function isFallbackOrNudgeMessage(text: string): boolean {
  const lower = text.toLowerCase().trim();
  return FALLBACK_PHRASES.some(phrase => lower.includes(phrase)) || lower === NUDGE_MESSAGE.toLowerCase();
}

function isEchoOfAgent(text: string, lastAgentText: string): boolean {
  if (!lastAgentText) return false;
  const lower = text.toLowerCase().trim();
  const agentLower = lastAgentText.toLowerCase().trim();

  if (lower.length < 10 || agentLower.length < 10) return false;

  const words = lower.split(/\s+/);
  const agentWords = agentLower.split(/\s+/);

  let matches = 0;
  for (const word of words) {
    if (word.length > 3 && agentWords.includes(word)) {
      matches++;
    }
  }

  return matches >= Math.min(3, words.length * 0.5);
}

class VoiceAgentSession {
  stt: DeepgramSTT | null = null;
  conversationHistory: any[] = [];
  currentOrderId: string | null = null;
  transcript: Array<{ speaker: string; text: string; timestamp: number }> = [];
  isCalling: boolean = false;
  orderId: string | null = null;
  silenceTimer: NodeJS.Timeout | null = null;
  lastTranscriptTime: number = Date.now();
  wsRef: WebSocket | null = null;
  callStartTime: number = 0;
  lastAgentMessage: string = '';

  // Barge-in handling
  interrupted: boolean = false;
  currentTtsPromise: Promise<Buffer> | null = null;
  isGeneratingTts: boolean = false;

  // Response processing
  isProcessing: boolean = false;
  nudgeCount: number = 0;
  private transcriptQueue: Promise<void> = Promise.resolve();

  async startCall(ws: WebSocket, orderId: string): Promise<void> {
    if (this.isCalling) {
      // Duplicate start_call on the same connection: tear down the previous
      // media resources first so nothing leaks.
      this.stopSilenceTimer();
      if (this.stt) {
        this.stt.stop();
        this.stt = null;
      }
    }

    this.orderId = orderId;
    this.transcript = [];
    this.isCalling = true;
    this.wsRef = ws;
    this.lastTranscriptTime = Date.now();
    this.callStartTime = Date.now();
    this.interrupted = false;
    this.nudgeCount = 0;

    this.conversationHistory = await createChatSession();

    safeSend(ws, JSON.stringify({ type: 'state', state: 'listening' }));
    safeSend(ws, JSON.stringify({ type: 'transcript', speaker: 'agent', text: 'Hello! Welcome to Aura Skincare support. How can I help you today?' }));
    this.lastAgentMessage = 'Hello! Welcome to Aura Skincare support. How can I help you today?';

    this.stt = new DeepgramSTT();
    this.stt.start();

    this.stt.onTranscript((transcript: string, isFinal: boolean, speechFinal: boolean) => {
      if (!this.isCalling) return;

      if (isFallbackOrNudgeMessage(transcript)) {
        console.log('[Echo prevention] Ignoring transcribed fallback/nudge message:', transcript);
        return;
      }

      if (isEchoOfAgent(transcript, this.lastAgentMessage)) {
        console.log('[Echo prevention] Ignoring echo of agent message:', transcript);
        return;
      }

      if (!isFinal && !speechFinal) {
        safeSend(ws, JSON.stringify({ type: 'transcript', speaker: 'customer', text: transcript, isInterim: true }));
        return;
      }

      this.lastTranscriptTime = Date.now();
      this.resetSilenceTimer();

      safeSend(ws, JSON.stringify({
        type: 'transcript',
        speaker: 'customer',
        text: transcript,
        timestamp: formatTimestamp(Date.now()),
      }));
      this.transcript.push({ speaker: 'customer', text: transcript, timestamp: Date.now() });

      // Serialize response processing so concurrent final transcripts cannot
      // interleave mutations of the shared conversation history.
      this.transcriptQueue = this.transcriptQueue
        .then(() => this.handleTranscript(ws, transcript))
        .catch(error => console.error('Transcript processing failed:', error));
    });

    this.startSilenceTimer(ws);
  }

  private startSilenceTimer(ws: WebSocket): void {
    this.stopSilenceTimer();
    this.silenceTimer = setInterval(() => {
      if (!this.isCalling || ws.readyState !== WebSocket.OPEN) {
        this.stopSilenceTimer();
        return;
      }

      // Never nudge while a response is being generated or spoken.
      if (this.isProcessing || this.isGeneratingTts) return;

      const timeSinceLastTranscript = Date.now() - this.lastTranscriptTime;
      if (timeSinceLastTranscript >= SILENCE_TIMEOUT_MS && this.nudgeCount < MAX_NUDGES_PER_CALL) {
        this.nudgeCount++;
        this.lastAgentMessage = NUDGE_MESSAGE;
        safeSend(ws, JSON.stringify({ type: 'nudge', text: NUDGE_MESSAGE }));
        this.lastTranscriptTime = Date.now();
      }
    }, 1000);
  }

  private resetSilenceTimer(): void {
    this.lastTranscriptTime = Date.now();
  }

  private stopSilenceTimer(): void {
    if (this.silenceTimer) {
      clearInterval(this.silenceTimer);
      this.silenceTimer = null;
    }
  }

  private async handleTranscript(ws: WebSocket, transcript: string): Promise<void> {
    if (!this.conversationHistory || !this.isCalling) return;

    this.interrupted = false;
    this.isProcessing = true;

    safeSend(ws, JSON.stringify({ type: 'state', state: 'thinking' }));

    try {
      const response = await getResponse(transcript, this.conversationHistory);
      if (!this.isCalling) return;

      if (this.interrupted) {
        // Barge-in happened while we were thinking; do not speak over the customer.
        console.log('[Barge-in] Response interrupted before playback');
        safeSend(ws, JSON.stringify({ type: 'state', state: 'listening' }));
        return;
      }

      safeSend(ws, JSON.stringify({ type: 'state', state: 'speaking' }));
      safeSend(ws, JSON.stringify({ type: 'transcript', speaker: 'agent', text: response }));
      this.lastAgentMessage = response;

      this.resetSilenceTimer();

      this.isGeneratingTts = true;
      this.currentTtsPromise = textToSpeech(response);

      try {
        const audioBuffer = await this.currentTtsPromise;
        this.isGeneratingTts = false;
        this.currentTtsPromise = null;

        if (!this.isCalling) return;

        if (this.interrupted) {
          console.log('[Barge-in] TTS generation interrupted, discarding audio');
          return;
        }

        safeSend(ws, Buffer.from(audioBuffer));

        this.transcript.push({ speaker: 'agent', text: response, timestamp: Date.now() });

        this.resetSilenceTimer();
        safeSend(ws, JSON.stringify({ type: 'state', state: 'listening' }));
      } catch (ttsError) {
        this.isGeneratingTts = false;
        this.currentTtsPromise = null;
        throw ttsError;
      }
    } catch (error) {
      console.error('Error processing transcript:', error);
      this.isGeneratingTts = false;
      this.currentTtsPromise = null;
      this.resetSilenceTimer();
      safeSend(ws, JSON.stringify({ type: 'state', state: 'listening' }));
    } finally {
      this.isProcessing = false;
    }
  }

  handleBargeIn(ws: WebSocket): void {
    if (!this.isCalling) return;

    console.log('[Barge-in] Server received barge_in, interrupting current response');
    this.interrupted = true;

    safeSend(ws, JSON.stringify({ type: 'state', state: 'listening' }));

    for (let i = this.transcript.length - 1; i >= 0; i--) {
      if (this.transcript[i].speaker === 'agent') {
        this.transcript[i].text += ' [interrupted]';
        break;
      }
    }
  }

  async endCall(ws: WebSocket, options: { summarize?: boolean } = {}): Promise<void> {
    const { summarize = true } = options;

    // Re-entrancy guard: only the first endCall for a live call does work.
    if (!this.isCalling && this.callStartTime === 0) return;

    this.isCalling = false;
    const durationSeconds = this.callStartTime > 0 ? Math.round((Date.now() - this.callStartTime) / 1000) : 0;
    this.callStartTime = 0;
    this.stopSilenceTimer();

    if (this.stt) {
      this.stt.stop();
      this.stt = null;
    }
    this.conversationHistory = [];

    if (summarize) {
      const summary = await generateSummary(this.transcript, durationSeconds);
      safeSend(ws, JSON.stringify({ type: 'call_ended', transcript: this.transcript, summary }));
    }

    this.transcript = [];
    this.orderId = null;
    this.wsRef = null;
    this.interrupted = false;
    this.isGeneratingTts = false;
    this.currentTtsPromise = null;
  }
}

const sessions = new Map<string, VoiceAgentSession>();

wss.on('connection', (ws: WebSocket) => {
  const clientId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const session = new VoiceAgentSession();
  sessions.set(clientId, session);

  console.log(`Client connected: ${clientId}`);

  ws.on('message', async (data: Buffer, isBinary: boolean) => {
    // Binary frames are microphone audio — route them without JSON parsing.
    // Text frames also arrive as Buffers in the ws library, so isBinary is
    // what actually distinguishes audio from protocol messages.
    if (isBinary && Buffer.isBuffer(data)) {
      const sessionForWs = sessions.get(clientId);
      if (sessionForWs && sessionForWs.isCalling && sessionForWs.stt) {
        sessionForWs.stt.sendAudio(data);
      }
      return;
    }

    let message: any;
    try {
      message = JSON.parse(String(data));
    } catch (error) {
      // Not JSON: fall back to treating it as audio for compatibility.
      const sessionForWs = sessions.get(clientId);
      if (Buffer.isBuffer(data) && sessionForWs && sessionForWs.isCalling && sessionForWs.stt) {
        sessionForWs.stt.sendAudio(data);
      } else {
        console.error('Unrecognized non-JSON message from client');
      }
      return;
    }

    try {
      switch (message.type) {
        case 'start_call': {
          if (session.isCalling) {
            console.log(`Ignoring duplicate start_call for ${clientId}`);
            return;
          }
          const orderId = message.orderId || 'ORD-101';
          const order = getOrderDetails(orderId);
          if ('found' in order && order.found === false) {
            const notFoundMessage = 'I could not find that order. Please verify the order ID.';
            session.lastAgentMessage = notFoundMessage;
            safeSend(ws, JSON.stringify({ type: 'transcript', speaker: 'agent', text: notFoundMessage }));
            return;
          }
          await session.startCall(ws, orderId);
          break;
        }
        case 'end_call': {
          await session.endCall(ws);
          sessions.delete(clientId);
          break;
        }
        case 'barge_in': {
          session.handleBargeIn(ws);
          break;
        }
      }
    } catch (error) {
      console.error(`Error handling client message for ${clientId}:`, error);
    }
  });

  ws.on('close', () => {
    const openSession = sessions.get(clientId);
    if (openSession && openSession.isCalling) {
      // Socket is gone: release resources without paying for a summary.
      void openSession.endCall(ws, { summarize: false });
    }
    sessions.delete(clientId);
    console.log(`Client disconnected: ${clientId}`);
  });

  ws.on('error', (error) => {
    console.error(`WebSocket error for ${clientId}:`, error);
    const openSession = sessions.get(clientId);
    if (openSession && openSession.isCalling) {
      void openSession.endCall(ws, { summarize: false });
    }
    sessions.delete(clientId);
  });
});

const PORT = Number(process.env.PORT || 3002);
httpServer.listen(PORT, () => {
  console.log(`Aura Voice Agent server running on port ${PORT}`);
});
