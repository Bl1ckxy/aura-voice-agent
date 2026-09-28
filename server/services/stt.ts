import { createClient, LiveTranscriptionEvents } from '@deepgram/sdk';

let deepgramClient: ReturnType<typeof createClient> | null = null;

function getDeepgramClient() {
  if (!deepgramClient) {
    const apiKey = process.env.DEEPGRAM_API_KEY || '';
    if (!apiKey) {
      console.error('❌ DEEPGRAM_API_KEY is missing in environment variables!');
      throw new Error('DEEPGRAM_API_KEY not set in environment');
    }
    deepgramClient = createClient(apiKey);
  }
  return deepgramClient;
}

const MAX_RECONNECT_ATTEMPTS = 5;
const MAX_PENDING_AUDIO_CHUNKS = 100;

export class DeepgramSTT {
  private connection: any = null;
  private onTranscriptCallback: ((transcript: string, isFinal: boolean, speechFinal: boolean) => void) | null = null;
  private connected: boolean = false;
  private stopped: boolean = false;
  private reconnectAttempts: number = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pendingAudio: Buffer[] = [];

  start(): void {
    this.stopped = false;
    this.connect();
  }

  private connect(): void {
    if (this.stopped) return;

    try {
      const dg = getDeepgramClient();

      // Deepgram SDK v3 live streaming method
      const liveConnection = dg.listen.live({
        model: 'nova-2',
        smart_format: true,
        interim_results: true,
        endpointing: 500,
        encoding: 'linear16',
        sample_rate: 16000,
      });

      this.connection = liveConnection;

      liveConnection.on(LiveTranscriptionEvents.Open, () => {
        if (this.stopped) {
          try { liveConnection.finish(); } catch { /* ignore */ }
          return;
        }
        this.connected = true;
        this.reconnectAttempts = 0;
        console.log('🎤 Deepgram STT connected successfully');
        this.flushPendingAudio();
      });

      liveConnection.on(LiveTranscriptionEvents.Transcript, (data: any) => {
        if (data.channel?.alternatives?.length > 0) {
          const transcript = data.channel.alternatives[0].transcript;
          const isFinal = Boolean(data.is_final);
          const speechFinal = Boolean(data.speech_final ?? isFinal);

          if (transcript && this.onTranscriptCallback) {
            this.onTranscriptCallback(transcript, isFinal, speechFinal);
          }
        }
      });

      liveConnection.on(LiveTranscriptionEvents.Error, (error: any) => {
        console.error('❌ Deepgram STT error:', error);
      });

      liveConnection.on(LiveTranscriptionEvents.Close, () => {
        if (this.connection !== liveConnection) return;
        this.connected = false;
        this.connection = null;
        console.warn('🎤 Deepgram STT connection closed');
        this.scheduleReconnect();
      });

    } catch (error) {
      console.error('❌ Failed to start Deepgram STT:', error);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.error('❌ Deepgram STT reconnect gave up after max attempts');
      return;
    }
    this.reconnectAttempts++;
    const delay = Math.min(500 * Math.pow(2, this.reconnectAttempts - 1), 8000);
    console.log(`🔄 Deepgram STT reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private flushPendingAudio(): void {
    if (!this.pendingAudio.length) return;
    const queued = this.pendingAudio.splice(0);
    for (const chunk of queued) {
      this.sendAudio(chunk);
    }
  }

  sendAudio(chunk: Buffer): void {
    if (this.connection && this.connected) {
      try {
        this.connection.send(chunk);
      } catch (error) {
        console.error('Deepgram STT sendAudio failed:', error);
      }
    } else if (!this.stopped) {
      this.pendingAudio.push(chunk);
      if (this.pendingAudio.length > MAX_PENDING_AUDIO_CHUNKS) {
        this.pendingAudio.shift();
      }
    }
  }

  onTranscript(callback: (transcript: string, isFinal: boolean, speechFinal: boolean) => void): void {
    this.onTranscriptCallback = callback;
  }

  stop(): void {
    this.stopped = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.pendingAudio = [];
    if (this.connection) {
      try {
        this.connection.finish();
      } catch (error) {
        console.error('Deepgram STT close failed:', error);
      }
      this.connection = null;
      this.connected = false;
    }
  }

  get isConnected(): boolean {
    return this.connected;
  }
}