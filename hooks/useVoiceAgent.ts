'use client';

import { useState, useRef, useCallback, useEffect } from 'react';
import { useAudioRecorder } from './useAudioRecorder';
import { useAudioPlayer } from './useAudioPlayer';

const getWsUrl = () => {
  const envUrl = process.env.NEXT_PUBLIC_WS_URL;
  if (envUrl && envUrl.trim() !== '' && !envUrl.includes('localhost')) {
    console.log("🔌 Connecting via env NEXT_PUBLIC_WS_URL:", envUrl);
    return envUrl;
  }
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost') {
    // Fixed: Removed trailing slash
    const railwayWsUrl = "wss://aura-voice-agent-production-380e.up.railway.app";
    console.log("🔌 Connecting via Railway Production Fallback:", railwayWsUrl);
    return railwayWsUrl;
  }
  console.log("🔌 Connecting via local default");
  return "ws://localhost:3002";
};

const RECONNECT_DELAY = 3000;
const MAX_RECONNECT_ATTEMPTS = 3;
const END_CALL_SUMMARY_TIMEOUT_MS = 5000;

interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: number | string;
  isInterim?: boolean;
}

export function useVoiceAgent() {
  const [callState, setCallState] = useState<'idle' | 'listening' | 'thinking' | 'speaking'>('idle');
  const [transcript, setTranscript] = useState<TranscriptEntry[]>([]);
  const [callSummary, setCallSummary] = useState<any>(null);
  const [callDuration, setCallDuration] = useState(0);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const callIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isRecordingRef = useRef(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const endCallTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pendingOrderIdRef = useRef<string | null>(null);
  const isIntentionalCloseRef = useRef(false);
  const reconnectAttemptsRef = useRef(0);

  // Barge-in detection refs
  const bargeInCheckIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const volumeThresholdCountRef = useRef(0);
  const isBargeInTriggeredRef = useRef(false);
  const bargeInActiveRef = useRef(false);
  const audioPlayingRef = useRef(false);
  const micMutedUntilRef = useRef(0);
  const lastGateBlockLogRef = useRef(0);

  const {
    startRecording,
    stopRecording,
    getVolumeLevel,
    isBargeInEnabled,
    setBargeInEnabled
  } = useAudioRecorder();

  // Make sure useAudioPlayer exposes resumeAudio or initAudio
  const { playAudio, stopAudio, isPlaying, onPlaybackComplete, initAudio } = useAudioPlayer();

  const sendAudioToServer = useCallback((chunk: ArrayBuffer) => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(chunk);
    }
  }, []);

  const clearReconnectTimeout = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
  }, []);

  const clearEndCallTimeout = useCallback(() => {
    if (endCallTimeoutRef.current) {
      clearTimeout(endCallTimeoutRef.current);
      endCallTimeoutRef.current = null;
    }
  }, []);

  const closeSocket = useCallback(() => {
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch (error) {
        console.debug('Error closing WebSocket:', error);
      }
      wsRef.current = null;
    }
  }, []);

  const stopBargeInMonitoring = useCallback(() => {
    if (bargeInCheckIntervalRef.current) {
      clearInterval(bargeInCheckIntervalRef.current);
      bargeInCheckIntervalRef.current = null;
    }
    volumeThresholdCountRef.current = 0;
    isBargeInTriggeredRef.current = false;
    bargeInActiveRef.current = false;
    setBargeInEnabled(false);
  }, [setBargeInEnabled]);

  const handleBargeIn = useCallback(() => {
    console.log('[Barge-in] Detected! Volume threshold exceeded for 300ms+');
    isBargeInTriggeredRef.current = true;
    stopAudio();
    micMutedUntilRef.current = 0;  // do NOT mute — user is speaking
    audioPlayingRef.current = false;

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'barge_in' }));
    }

    stopBargeInMonitoring();
  }, [stopAudio, stopBargeInMonitoring]);

  const startBargeInMonitoring = useCallback(() => {
    if (bargeInCheckIntervalRef.current) return;

    setBargeInEnabled(true);
    bargeInActiveRef.current = true;
    isBargeInTriggeredRef.current = false;
    volumeThresholdCountRef.current = 0;

    bargeInCheckIntervalRef.current = setInterval(() => {
      const volume = getVolumeLevel();

      if (volume > 40) {
        volumeThresholdCountRef.current += 1;
        if (volumeThresholdCountRef.current >= 12 && !isBargeInTriggeredRef.current) {
          handleBargeIn();
        }
      } else {
        volumeThresholdCountRef.current = 0;
      }
    }, 25);
  }, [getVolumeLevel, setBargeInEnabled, handleBargeIn]);

  useEffect(() => {
    onPlaybackComplete(() => {
      audioPlayingRef.current = false;
      const isBargeIn = isBargeInTriggeredRef.current;
      if (isBargeIn) {
        micMutedUntilRef.current = 0;
        console.log('[mic-cooldown] barge-in: cooldown skipped');
      } else {
        micMutedUntilRef.current = Date.now() + 600;  // ~600ms reverb tail
        console.log('[mic-cooldown] started: 600ms mute window');
      }
      setCallState(prev => (prev === 'speaking' ? 'listening' : prev));
      stopBargeInMonitoring();

      if (!isBargeIn && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        console.log('[playback] sending playback_done to server');
        wsRef.current.send(JSON.stringify({ type: 'playback_done' }));
      }
    });
  }, [onPlaybackComplete, stopBargeInMonitoring]);

  const connect = useCallback(async (orderId?: string) => {
    if (isIntentionalCloseRef.current) return;

    if (wsRef.current) {
      const oldWs = wsRef.current;
      oldWs.onopen = null;
      oldWs.onmessage = null;
      oldWs.onerror = null;
      oldWs.onclose = null;
      try { oldWs.close(); } catch (error) { console.debug('Error closing old WebSocket:', error); }
      wsRef.current = null;
    }
    if (isRecordingRef.current) {
      stopRecording();
      isRecordingRef.current = false;
    }
    if (callIntervalRef.current) {
      clearInterval(callIntervalRef.current);
      callIntervalRef.current = null;
    }

    try {
      const targetUrl = getWsUrl();
      const ws = new WebSocket(targetUrl);
      
      // FIX 2: Explicitly request ArrayBuffer for binary WebSocket messages
      ws.binaryType = 'arraybuffer';
      wsRef.current = ws;
      pendingOrderIdRef.current = orderId || 'ORD-101';

      ws.onopen = () => {
        console.log('✅ WebSocket connected to:', targetUrl);
        setConnectionError(null);
        reconnectAttemptsRef.current = 0;
        ws.send(JSON.stringify({ type: 'start_call', orderId: pendingOrderIdRef.current }));
        setCallState('listening');
        micMutedUntilRef.current = 0;
        audioPlayingRef.current = false;

        startRecording((chunk) => {
          // Barge-in detection is LOCAL (AnalyserNode) — never open the send
          // gate just because barge-in monitoring is active. That was feeding
          // speaker output into Deepgram for the entire agent turn.
          const now = Date.now();
          if (!audioPlayingRef.current && now >= micMutedUntilRef.current) {
            sendAudioToServer(chunk);
          } else if (now - lastGateBlockLogRef.current > 1000) {
            lastGateBlockLogRef.current = now;
            console.log(
              `[mic-gate] audio chunk blocked (${audioPlayingRef.current ? 'audio playing' : `in cooldown, ${micMutedUntilRef.current - now}ms left`})`
            );
          }
        });
        isRecordingRef.current = true;

        callIntervalRef.current = setInterval(() => {
          setCallDuration(prev => prev + 1);
        }, 1000);
      };

      ws.onmessage = async (event) => {
        const data = event.data;

        if (typeof data === 'string') {
          let message: any;
          try {
            message = JSON.parse(data);
          } catch (error) {
            console.warn('Ignoring malformed WebSocket message:', error);
            return;
          }

          switch (message.type) {
            case 'state':
              if (message.state === 'speaking') {
                setCallState('speaking');
                startBargeInMonitoring();
              } else if (message.state === 'listening') {
                if (audioPlayingRef.current) {
                  break;
                }
                setCallState('listening');
                stopBargeInMonitoring();
              } else {
                setCallState(message.state);
                stopBargeInMonitoring();
              }
              break;
            case 'transcript':
              setTranscript(prev => {
                const next = [...prev];
                const interimIndex = next.findIndex(entry => entry.isInterim && entry.speaker === message.speaker);
                const entry = {
                  speaker: message.speaker,
                  text: message.text,
                  timestamp: message.timestamp || Date.now(),
                  isInterim: Boolean(message.isInterim)
                };

                if (message.isInterim && interimIndex >= 0) {
                  next[interimIndex] = entry;
                } else if (!message.isInterim && interimIndex >= 0) {
                  next[interimIndex] = entry;
                } else {
                  next.push(entry);
                }
                return next;
              });
              break;
            case 'call_ended':
              clearEndCallTimeout();
              isIntentionalCloseRef.current = true;
              reconnectAttemptsRef.current = 0;
              closeSocket();
              setCallSummary(message.summary);
              setTranscript(message.transcript || []);
              setCallState('idle');
              if (isRecordingRef.current) {
                stopRecording();
                isRecordingRef.current = false;
              }
              if (callIntervalRef.current) {
                clearInterval(callIntervalRef.current);
                callIntervalRef.current = null;
              }
              stopBargeInMonitoring();
              break;
            case 'nudge':
              setTranscript(prev => [...prev, {
                speaker: 'agent',
                text: message.text,
                timestamp: Date.now()
              }]);
              break;
            case 'reconnect':
              setConnectionError('Connection lost. Reconnecting...');
              break;
          }
        } else if (data instanceof ArrayBuffer || data instanceof Blob) {
          audioPlayingRef.current = true;
          setCallState('speaking');
          startBargeInMonitoring();

          const buffer = data instanceof Blob ? await data.arrayBuffer() : data;
          console.log("🔊 Received audio buffer size:", buffer.byteLength);
          await playAudio(buffer);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        setConnectionError('Connection error. Attempting to reconnect...');
      };

      ws.onclose = (event) => {
        console.log('🔌 Connection CLOSED — code:', event.code, '| reason:', event.reason);

        if (callIntervalRef.current) {
          clearInterval(callIntervalRef.current);
          callIntervalRef.current = null;
        }
        if (isRecordingRef.current) {
          stopRecording();
          isRecordingRef.current = false;
        }
        stopAudio();
        stopBargeInMonitoring();
        audioPlayingRef.current = false;
        micMutedUntilRef.current = 0;

        if (!isIntentionalCloseRef.current && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttemptsRef.current += 1;
          setConnectionError(`Connection lost. Reconnecting... (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})`);

          reconnectTimeoutRef.current = setTimeout(() => {
            reconnectTimeoutRef.current = null;
            connect(pendingOrderIdRef.current || undefined);
          }, RECONNECT_DELAY);
        } else if (!isIntentionalCloseRef.current) {
          setConnectionError('Connection lost. Please click "Reconnect" to try again.');
          setCallState('idle');
        }
      };
    } catch (error) {
      console.error('Failed to start call:', error);
      setConnectionError('Failed to connect. Please try again.');
      setCallState('idle');
    }
  }, [
    startRecording,
    stopRecording,
    playAudio,
    stopAudio,
    sendAudioToServer,
    startBargeInMonitoring,
    stopBargeInMonitoring,
    closeSocket,
    clearEndCallTimeout
  ]);

  // FIX 1: Unlock AudioContext directly during user click
  const startCall = useCallback(async (orderId?: string) => {
    if (initAudio) {
      await initAudio(); // Unlocks Web Audio API on click!
    }
    isIntentionalCloseRef.current = false;
    reconnectAttemptsRef.current = 0;
    setCallDuration(0);
    await connect(orderId);
  }, [connect, initAudio]);

  const endCall = useCallback(() => {
    isIntentionalCloseRef.current = true;
    clearReconnectTimeout();
    clearEndCallTimeout();

    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'end_call' }));
      endCallTimeoutRef.current = setTimeout(() => {
        endCallTimeoutRef.current = null;
        closeSocket();
      }, END_CALL_SUMMARY_TIMEOUT_MS);
    } else {
      closeSocket();
    }

    if (isRecordingRef.current) {
      stopRecording();
      isRecordingRef.current = false;
    }

    if (callIntervalRef.current) {
      clearInterval(callIntervalRef.current);
      callIntervalRef.current = null;
    }
    stopBargeInMonitoring();
    audioPlayingRef.current = false;
    micMutedUntilRef.current = 0;

    setCallState('idle');
  }, [stopRecording, clearReconnectTimeout, clearEndCallTimeout, closeSocket, stopBargeInMonitoring]);

  const reconnect = useCallback(() => {
    isIntentionalCloseRef.current = false;
    reconnectAttemptsRef.current = 0;
    setConnectionError(null);
    connect(pendingOrderIdRef.current || undefined);
  }, [connect]);

  useEffect(() => {
    return () => {
      clearReconnectTimeout();
      clearEndCallTimeout();
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, [clearReconnectTimeout, clearEndCallTimeout]);

  return {
    startCall,
    endCall,
    reconnect,
    callState,
    transcript,
    callSummary,
    callDuration,
    isPlaying,
    isBargeInEnabled,
    connectionError
  };
}