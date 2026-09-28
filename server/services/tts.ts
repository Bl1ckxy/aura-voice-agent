import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';
import { Readable } from 'node:stream';

const DEEPGRAM_TTS_URL = 'https://api.deepgram.com/v1/speak?model=aura-asteria-en';

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
    stream.once('end', () => resolve(Buffer.concat(chunks)));
    stream.once('error', reject);
  });
}

async function edgeTextToSpeech(text: string): Promise<Buffer> {
  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata('en-IN-NeerjaNeural', OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
    const { audioStream } = (tts.toStream(text) as unknown as { audioStream: Readable; metadataStream: Readable | null });
    return await streamToBuffer(audioStream);
  } finally {
    tts.close();
  }
}

async function deepgramTextToSpeech(text: string): Promise<Buffer> {
  const apiKey = process.env.DEEPGRAM_API_KEY;
  if (!apiKey) throw new Error('DEEPGRAM_API_KEY is not configured');
  const response = await fetch(DEEPGRAM_TTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'audio/mpeg',
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) throw new Error(`Deepgram TTS failed: ${response.status} ${await response.text()}`);
  return Buffer.from(await response.arrayBuffer());
}

const ATTEMPT_TIMEOUT_MS = 7000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      error => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function textToSpeech(text: string): Promise<Buffer> {
  if (!text || !text.trim()) {
    throw new Error('TTS text is empty');
  }
  try {
    return await withTimeout(edgeTextToSpeech(text), ATTEMPT_TIMEOUT_MS, 'Edge TTS');
  } catch (edgeError) {
    console.error('Edge-TTS Error, falling back to Deepgram TTS:', edgeError);
    return withTimeout(deepgramTextToSpeech(text), ATTEMPT_TIMEOUT_MS, 'Deepgram TTS');
  }
}
