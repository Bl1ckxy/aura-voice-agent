'use client';

import { useRef, useCallback, useState, useEffect } from 'react';

interface AudioRecorderReturn {
  startRecording: (onChunk: (chunk: ArrayBuffer) => void) => Promise<void>;
  stopRecording: () => void;
  isRecording: boolean;
  getVolumeLevel: () => number;
  isBargeInEnabled: boolean;
  setBargeInEnabled: (enabled: boolean) => void;
}

export function useAudioRecorder(): AudioRecorderReturn {
  const audioContextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const onAudioChunkRef = useRef<((chunk: ArrayBuffer) => void) | null>(null);
  const recordingActiveRef = useRef(false);
  const workletLoaded = useRef(false);
  const [isBargeInEnabled, setIsBargeInEnabled] = useState(false);
  const volumeCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volumeLevelRef = useRef(0);

  const startRecording = useCallback(async (onChunk: (chunk: ArrayBuffer) => void) => {
    try {
      setIsRecording(true);
      recordingActiveRef.current = true;
      onAudioChunkRef.current = onChunk;

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: false,
          autoGainControl: false
        }
      });

      streamRef.current = stream;
      const nativeSampleRate = 48000;
      audioContextRef.current = new AudioContext({ sampleRate: nativeSampleRate });

      if (!workletLoaded.current) {
        await audioContextRef.current.audioWorklet.addModule('/audio-processor.js');
        workletLoaded.current = true;
      }

      const source = audioContextRef.current.createMediaStreamSource(stream);
      
      // Create analyser node for volume detection (barge-in)
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 256;
      analyserRef.current.smoothingTimeConstant = 0.3;
      
      // Connect source -> analyser -> processor -> destination
      // This keeps the mic stream alive and allows volume analysis
      processorRef.current = new AudioWorkletNode(audioContextRef.current, 'pcm-processor', {
        processorOptions: { targetSampleRate: 16000 }
      });

      (processorRef.current as AudioWorkletNode).port.onmessage = (event) => {
        if (!recordingActiveRef.current) return;
        if (event.data.type === 'pcm' && onAudioChunkRef.current) {
          onAudioChunkRef.current(event.data.buffer);
        }
      };

      source.connect(analyserRef.current);
      analyserRef.current.connect(processorRef.current);
      processorRef.current.connect(audioContextRef.current.destination);

      // Start volume monitoring interval
      volumeCheckIntervalRef.current = setInterval(() => {
        if (analyserRef.current) {
          const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
          analyserRef.current.getByteFrequencyData(dataArray);
          
          // Calculate average volume (0-255) then normalize to 0-100
          const sum = dataArray.reduce((a, b) => a + b, 0);
          const average = sum / dataArray.length;
          volumeLevelRef.current = Math.round((average / 255) * 100);
        }
      }, 25); // ~40fps for smooth detection
      
    } catch (error) {
      console.error('Failed to start recording:', error);
      setIsRecording(false);
      recordingActiveRef.current = false;
    }
  }, []);

  const stopRecording = useCallback(() => {
    setIsRecording(false);
    setIsBargeInEnabled(false);

    if (volumeCheckIntervalRef.current) {
      clearInterval(volumeCheckIntervalRef.current);
      volumeCheckIntervalRef.current = null;
    }

    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }

    if (analyserRef.current) {
      analyserRef.current.disconnect();
      analyserRef.current = null;
    }

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }

    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
  }, []);

  const getVolumeLevel = useCallback(() => {
    return volumeLevelRef.current;
  }, []);

  const setBargeInEnabled = useCallback((enabled: boolean) => {
    setIsBargeInEnabled(enabled);
  }, []);

  return { 
    startRecording, 
    stopRecording, 
    isRecording, 
    getVolumeLevel,
    isBargeInEnabled,
    setBargeInEnabled
  };
}

function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, outputSampleRate: number): Float32Array {
  if (inputSampleRate === outputSampleRate) return buffer;
  
  const ratio = inputSampleRate / outputSampleRate;
  const outputLength = Math.round(buffer.length / ratio);
  const result = new Float32Array(outputLength);
  
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = Math.floor(i * ratio);
    result[i] = buffer[srcIndex];
  }
  
  return result;
}

function convertFloat32ToInt16(buffer: Float32Array): Int16Array {
  const result = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i++) {
    const s = Math.max(-1, Math.min(1, buffer[i]));
    result[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
  }
  return result;
}