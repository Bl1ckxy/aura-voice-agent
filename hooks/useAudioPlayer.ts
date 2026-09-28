'use client';

import { useRef, useState, useCallback } from 'react';

export function useAudioPlayer() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const playQueueRef = useRef<ArrayBuffer[]>([]);
  const isPlayingRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const onPlaybackCompleteRef = useRef<(() => void) | null>(null);
  const currentSourceRef = useRef<AudioBufferSourceNode | null>(null);

  const ensureAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    return audioContextRef.current;
  }, []);

  const playAudio = useCallback(async (buffer: ArrayBuffer) => {
    try {
      const ctx = ensureAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      
      playQueueRef.current.push(buffer);
      
      if (!isPlayingRef.current) {
        isPlayingRef.current = true;
        setIsPlaying(true);
        processQueue(ctx);
      }
    } catch (error) {
      console.error('Failed to play audio:', error);
    }
  }, [ensureAudioContext]);

  const processQueue = async (ctx: AudioContext) => {
    while (playQueueRef.current.length > 0) {
      const buffer = playQueueRef.current.shift()!;
      try {
        const audioBuffer = await ctx.decodeAudioData(buffer.slice(0));
        const source = ctx.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(ctx.destination);
        currentSourceRef.current = source;
        source.start();
        
        await new Promise<void>((resolve) => {
          source.onended = () => {
            currentSourceRef.current = null;
            resolve();
          };
        });
      } catch (error) {
        console.error('Failed to decode audio:', error);
        currentSourceRef.current = null;
      }
    }
    
    isPlayingRef.current = false;
    setIsPlaying(false);
    currentSourceRef.current = null;
    if (onPlaybackCompleteRef.current) {
      onPlaybackCompleteRef.current();
    }
  };

  const stopAudio = useCallback(() => {
    // 1. Clear the playback queue immediately
    playQueueRef.current = [];
    
    // 2. Stop the currently playing source node instantly (no fade)
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
        currentSourceRef.current.disconnect();
      } catch (error) {
        // Source might already be stopped/ended
        console.debug('Error stopping audio source:', error);
      }
      currentSourceRef.current = null;
    }
    
    // 3. Reset playing state
    isPlayingRef.current = false;
    setIsPlaying(false);
    
    // 4. Suspend audio context to ensure no residual playback
    if (audioContextRef.current && audioContextRef.current.state === 'running') {
      audioContextRef.current.suspend();
    }
    
    // 5. Call the completion callback so the agent knows playback was interrupted
    if (onPlaybackCompleteRef.current) {
      onPlaybackCompleteRef.current();
    }
  }, []);

  const setOnPlaybackComplete = useCallback((callback: () => void) => {
    onPlaybackCompleteRef.current = callback;
  }, []);

  return {
    playAudio,
    stopAudio,
    isPlaying,
    onPlaybackComplete: setOnPlaybackComplete
  };
}