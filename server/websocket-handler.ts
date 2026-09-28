import { WebSocket } from 'ws';
import { DeepgramSTT } from './services/stt';
import { textToSpeech } from './services/tts';
import { createChatSession, getResponse, generateSummary } from './services/llm';

export class WebsocketHandler {
  private stt: DeepgramSTT | null = null;
  private chatSession: any = null;
  private currentOrderId: string | null = null;
  private transcript: Array<{ speaker: string; text: string; timestamp: number }> = [];
  private callStartTime: number = 0;

  async startCall(websocket: WebSocket, orderId: string): Promise<void> {
    this.currentOrderId = orderId;
    this.transcript = [];
    this.callStartTime = Date.now();
    
    websocket.send(JSON.stringify({ type: 'state', state: 'listening' }));
    websocket.send(JSON.stringify({ type: 'transcript', speaker: 'agent', text: 'Hello! How can I help you with your Aura Skincare order today?' }));
    
    this.stt = new DeepgramSTT();
    this.chatSession = await createChatSession();
    this.stt.start();
    
    this.stt.onTranscript((transcript: string, isFinal: boolean) => {
      if (isFinal) {
        websocket.send(JSON.stringify({ type: 'transcript', speaker: 'customer', text: transcript }));
        this.handleCustomerTranscript(websocket, transcript);
      } else {
        websocket.send(JSON.stringify({ type: 'transcript', speaker: 'customer', text: transcript }));
      }
    });
  }

  private async handleCustomerTranscript(websocket: WebSocket, transcript: string): Promise<void> {
    if (!this.chatSession || !this.currentOrderId) return;
    
    websocket.send(JSON.stringify({ type: 'state', state: 'thinking' }));
    
    try {
      const response = await getResponse(transcript, this.chatSession);
      
      websocket.send(JSON.stringify({ type: 'state', state: 'speaking' }));
      
      const audioBuffer = await textToSpeech(response);
      
      websocket.send(JSON.stringify({ type: 'state', state: 'listening' }));
      
      websocket.send(Buffer.from(audioBuffer));
      
      this.transcript.push({ speaker: 'agent', text: response, timestamp: Date.now() });
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
    } catch (error) {
      console.error('Error processing transcript:', error);
      websocket.send(JSON.stringify({ type: 'state', state: 'listening' }));
    }
  }

  endCall(websocket: WebSocket): { transcript: any[]; summary: any } {
    if (this.chatSession) {
      this.stt?.stop();
      this.stt = null;
      this.chatSession = null;
    }
    
    const durationSeconds = Math.round((Date.now() - (this.callStartTime || Date.now())) / 1000);
    const summary = generateSummary(this.transcript, durationSeconds);
    
    websocket.send(JSON.stringify({ 
      type: 'call_ended', 
      transcript: this.transcript,
      summary
    }));
    
    return { transcript: this.transcript, summary };
  }

  sendAudio(websocket: WebSocket, chunk: Buffer): void {
    websocket.send(chunk);
  }
}