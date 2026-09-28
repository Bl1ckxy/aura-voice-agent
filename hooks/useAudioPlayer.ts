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
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      audioContextRef.current = new AudioCtx();
    }
    return audioContextRef.current;
  }, []);

  // Unlock AudioContext directly during user click gesture (Start Call)
  const initAudio = useCallback(async () => {
    try {
      const ctx = ensureAudioContext();
      if (ctx.state === 'suspended') {
        await ctx.resume();
        console.log('🔊 AudioContext unlocked successfully!');
      }
    } catch (error) {
      console.error('Failed to initialize AudioContext:', error);
    }
  }, [ensureAudioContext]);

  const processQueue = async (ctx: AudioContext) => {
    while (playQueueRef.current.length > 0) {
      const buffer = playQueueRef.current.shift()!;
      try {
        if (ctx.state === 'suspended') {
          await ctx.resume();
        }
        
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
        console.error('Failed to decode/play audio chunk:', error);
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

  const playAudio = useCallback(async (buffer: ArrayBuffer) => {
    try {
      const ctx = ensureAudioContext();
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

  const stopAudio = useCallback(() => {
    // 1. Clear the playback queue immediately
    playQueueRef.current = [];
    
    // 2. Stop the currently playing source node instantly
    if (currentSourceRef.current) {
      try {
        currentSourceRef.current.stop();
        currentSourceRef.current.disconnect();
      } catch (error) {
        console.debug('Error stopping audio source:', error);
      }
      currentSourceRef.current = null;
    }
    
    // 3. Reset playing state (DO NOT suspend AudioContext, so next audio plays instantly!)
    isPlayingRef.current = false;
    setIsPlaying(false);
    
    // 4. Call the completion callback so the agent knows playback was interrupted
    if (onPlaybackCompleteRef.current) {
      onPlaybackCompleteRef.current();
    }
  }, []);

  const setOnPlaybackComplete = useCallback((callback: () => void) => {
    onPlaybackCompleteRef.current = callback;
  }, []);

  return {
    initAudio,
    playAudio,
    stopAudio,
    isPlaying,
    onPlaybackComplete: setOnPlaybackComplete
  };
}