'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useVoiceAgent } from '@/hooks/useVoiceAgent';
import { Mic, MicOff, X, ChevronDown, Download, ExternalLink, AlertCircle } from 'lucide-react';

interface CallSummary {
  customer_intent: 'ORDER_TRACKING' | 'RETURN_REQUEST' | 'CANCELLATION' | 'PRODUCT_INQUIRY' | 'COMPLAINT' | 'GENERAL_QUERY';
  order_id: string | null;
  customer_name: string | null;
  resolution_status: 'RESOLVED' | 'UNRESOLVED' | 'ESCALATED' | 'INFORMATION_PROVIDED';
  action_taken: string;
  call_summary: string;
  follow_up_required: boolean;
  sentiment: 'POSITIVE' | 'NEUTRAL' | 'NEGATIVE';
  call_duration_seconds: number;
}

interface TranscriptEntry {
  speaker: string;
  text: string;
  timestamp: number | string;
  isInterim?: boolean;
}

const testOrders = [
  { id: 'ORD-101', customer: 'Priya Sharma', product: 'Vitamin C Serum (30ml)', price: 699, status: 'Out for Delivery', statusColor: 'bg-blue-50 text-blue-700 border-blue-100', note: 'BlueDart BD-982103 • Expected by 6 PM today' },
  { id: 'ORD-102', customer: 'Rahul Verma', product: 'Hydrating Sunscreen SPF 50', price: 499, status: 'Delivered', statusColor: 'bg-green-50 text-green-700 border-green-100', note: 'Delhivery DL-441029 • Delivered 14 days ago' },
  { id: 'ORD-103', customer: 'Ananya Patel', product: 'Green Tea Face Wash + Toner', price: 850, status: 'Processing', statusColor: 'bg-amber-50 text-amber-700 border-amber-100', note: 'Ordered 3 hours ago • Eligible for cancellation' },
];

const suggestedPrompts = [
  'Where is my order ORD-101?',
  'Cancel my order ORD-103',
  'Can I return ORD-102?',
  'What is your return policy?',
];

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function formatTimestamp(ts: number | string): string {
  const date = typeof ts === 'number' ? new Date(ts) : new Date(`1970-01-01T${ts}`);
  if (Number.isNaN(date.getTime())) return String(ts);
  return date.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function getStatusText(status: string): string {
  switch (status) {
    case 'RESOLVED': return 'Resolved';
    case 'UNRESOLVED': return 'Unresolved';
    case 'ESCALATED': return 'Escalated';
    case 'INFORMATION_PROVIDED': return 'Info Provided';
    default: return status;
  }
}

function getIntentText(intent: string): string {
  return intent.replace('_', ' ');
}

function getSentimentText(sentiment: string): string {
  return sentiment.charAt(0) + sentiment.slice(1).toLowerCase();
}

function getSentimentEmoji(sentiment: string): string {
  switch (sentiment) {
    case 'POSITIVE': return '😊';
    case 'NEGATIVE': return '😞';
    default: return '😐';
  }
}

function StatusIndicator({ state }: { state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'connecting' }) {
  return (
    <div className="flex items-center gap-3">
      <div className="relative flex items-center">
        {state === 'listening' && (
          <>
            <div className="absolute inset-0 w-8 h-8 rounded-full bg-green-500/30 animate-ping" />
            <div className="absolute inset-0 w-8 h-8 rounded-full bg-green-500/20 animate-ping" style={{ animationDelay: '0.5s' }} />
          </>
        )}
        {state === 'speaking' && (
          <>
            <div className="absolute inset-0 w-8 h-8 rounded-full bg-blue-500/30 animate-ping" />
            <div className="absolute inset-0 w-8 h-8 rounded-full bg-blue-500/20 animate-ping" style={{ animationDelay: '0.5s' }} />
          </>
        )}
        <div className={`relative w-8 h-8 rounded-full flex items-center justify-center ${
          state === 'listening' ? 'bg-green-500' :
          state === 'thinking' ? 'bg-amber-500' :
          state === 'speaking' ? 'bg-blue-500' :
          state === 'error' ? 'bg-red-500' :
          state === 'connecting' ? 'bg-gray-400 animate-pulse' : 'bg-gray-300'
        }`}>
          {state === 'listening' && <Mic className="w-4 h-4 text-white" />}
          {state === 'thinking' && (
            <div className="flex items-center gap-0.5">
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          )}
          {state === 'speaking' && (
            <div className="flex items-center gap-1 h-4">
              <div className="w-1 bg-white rounded animate-[equalizer_0.6s_ease-in-out_infinite]" style={{ animationDelay: '0ms', height: '30%' }} />
              <div className="w-1 bg-white rounded animate-[equalizer_0.6s_ease-in-out_infinite]" style={{ animationDelay: '80ms', height: '55%' }} />
              <div className="w-1 bg-white rounded animate-[equalizer_0.6s_ease-in-out_infinite]" style={{ animationDelay: '160ms', height: '75%' }} />
              <div className="w-1 bg-white rounded animate-[equalizer_0.6s_ease-in_out_infinite]" style={{ animationDelay: '240ms', height: '45%' }} />
            </div>
          )}
          {state === 'error' && <AlertCircle className="w-4 h-4 text-white" />}
          {state === 'connecting' && <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          {state === 'idle' && <Mic className="w-4 h-4 text-gray-500" />}
        </div>
      </div>
      <span className="text-sm font-medium text-gray-700 min-w-[90px]">
        {state === 'listening' && 'Listening'}
        {state === 'thinking' && 'Thinking…'}
        {state === 'speaking' && 'Speaking'}
        {state === 'error' && 'Error'}
        {state === 'connecting' && 'Connecting…'}
        {state === 'idle' && 'Ready'}
      </span>
    </div>
  );
}

function CallButton({ state, onClick, disabled, className = '' }: { 
  state: 'idle' | 'listening' | 'thinking' | 'speaking' | 'connecting' | 'error'; 
  onClick: () => void; 
  disabled?: boolean; 
  className?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [ripple, setRipple] = useState<{ x: number; y: number } | null>(null);

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (disabled) return;
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) {
      setRipple({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      setTimeout(() => setRipple(null), 600);
    }
    onClick();
  };

  const baseClasses = `
    relative overflow-hidden w-full min-h-[56px] sm:min-h-[64px] lg:min-h-[72px] 
    rounded-xl font-semibold text-base sm:text-lg lg:text-xl
    transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2
    disabled:opacity-50 disabled:cursor-not-allowed
    ${className}
  `;

  if (state === 'idle' || state === 'error') {
    return (
      <button
        ref={buttonRef}
        onClick={handleClick}
        disabled={disabled}
        className={`
          ${baseClasses}
          bg-gradient-to-br from-teal-600 to-teal-700 text-white
          hover:from-teal-700 hover:to-teal-800
          active:from-teal-800 active:to-teal-900
          shadow-lg shadow-teal-500/25
          disabled:from-gray-400 disabled:to-gray-500 disabled:shadow-none
        `}
      >
        <span className="relative z-10 flex items-center justify-center gap-2">
          <Mic className="w-5 h-5" />
          Start Call
        </span>
        {ripple && (
          <div
            className="absolute rounded-full bg-white/30 animate-[ripple_600ms_ease-out_forwards] pointer-events-none"
            style={{
              left: ripple.x,
              top: ripple.y,
              width: '200px',
              height: '200px',
              marginLeft: '-100px',
              marginTop: '-100px',
            }}
          />
        )}
      </button>
    );
  }
  if (state === 'connecting') {
    return (
      <button disabled className={`${baseClasses} bg-gray-100 text-gray-500 cursor-not-allowed`}>
        <span className="flex items-center justify-center gap-2">
          <div className="w-5 h-5 border-2 border-teal-600 border-t-transparent rounded-full animate-spin" />
          Connecting…
        </span>
      </button>
    );
  }
  return (
    <button
      ref={buttonRef}
      onClick={handleClick}
      disabled={disabled}
      className={`
        ${baseClasses}
        bg-white border-2 border-red-500 text-red-600
        hover:bg-red-50 active:bg-red-100
        disabled:bg-gray-50 disabled:border-gray-300 disabled:text-gray-400
      `}
    >
      <span className="relative z-10 flex items-center justify-center gap-2">
        <MicOff className="w-5 h-5" />
        End Call
      </span>
      {ripple && (
        <div
          className="absolute rounded-full bg-red-500/20 animate-[ripple_600ms_ease-out_forwards] pointer-events-none"
          style={{
            left: ripple.x,
            top: ripple.y,
            width: '200px',
            height: '200px',
            marginLeft: '-100px',
            marginTop: '-100px',
          }}
        />
      )}
    </button>
  );
}

function VolumeIndicator({ level }: { level: number }) {
  return (
    <div className="flex items-end gap-1 h-8">
      {[1, 2, 3, 4, 5].map((i) => (
        <div
          key={i}
          className={`w-1.5 rounded transition-all duration-100 ${
            i <= level ? 'bg-teal-500' : 'bg-gray-200'
          }`}
          style={{ height: `${15 + i * 8}px` }}
        />
      ))}
    </div>
  );
}

function TranscriptView({ transcript, isInCall }: { transcript: TranscriptEntry[]; isInCall: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' });
  }, [transcript]);

  if (!isInCall && transcript.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-gray-400">
        <Mic className="w-12 h-12 mb-3 opacity-30" />
        <p className="text-sm">Start a call to see the transcript here.</p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full overflow-y-auto space-y-4 pr-1">
      {transcript.map((msg, idx) => (
        <div key={idx} className={`animate-fade-in ${msg.isInterim ? 'opacity-60' : ''}`}>
          <div className="flex gap-3">
            <span className="w-20 shrink-0 text-right text-xs font-mono text-gray-400">
              {formatTimestamp(msg.timestamp)}
            </span>
            <div className="flex-1 min-w-0">
              <div className="flex items-baseline gap-2">
                <span className={`text-sm font-semibold ${msg.speaker === 'customer' ? 'text-gray-500' : 'text-teal-600'}`}>
                  {msg.speaker === 'customer' ? 'You' : 'Aria'}
                </span>
                {msg.isInterim && <span className="text-xs text-gray-400 italic">(partial)</span>}
              </div>
              <p className="text-base text-gray-800 leading-relaxed mt-0.5 whitespace-pre-wrap">
                {msg.text}
              </p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function CallSummaryView({ summary, transcript, onDownload, onNewCall, onToggleJson, showJson }: {
  summary: CallSummary;
  transcript: TranscriptEntry[];
  onDownload: () => void;
  onNewCall: () => void;
  onToggleJson: () => void;
  showJson: boolean;
}) {
  return (
    <div className="animate-slide-up border-t border-[var(--border)] bg-[var(--panel-bg)] pt-6">
      <h3 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
        <span className="w-2 h-6 bg-teal-500 rounded-l" />
        Call Summary
      </h3>
      
      <div className="flex flex-wrap gap-2 mb-4">
        <span className="inline-flex items-center px-3 py-1.5 text-sm bg-white border border-[var(--border)] rounded-lg">
          <span className="text-gray-500 mr-1">Intent:</span>
          <span className="font-medium text-gray-900">{getIntentText(summary.customer_intent)}</span>
        </span>
        <span className="inline-flex items-center px-3 py-1.5 text-sm bg-white border border-[var(--border)] rounded-lg">
          <span className="text-gray-500 mr-1">Status:</span>
          <span className={`ml-1 font-medium ${summary.resolution_status === 'RESOLVED' ? 'text-green-700' : 'text-red-700'}`}>
            {summary.resolution_status === 'RESOLVED' ? '✅ Resolved' : '❌ Unresolved'}
          </span>
        </span>
        <span className="inline-flex items-center px-3 py-1.5 text-sm bg-white border border-[var(--border)] rounded-lg">
          <span className="text-gray-500 mr-1">Sentiment:</span>
          <span className="ml-1 font-medium text-gray-900">{getSentimentEmoji(summary.sentiment)} {getSentimentText(summary.sentiment)}</span>
        </span>
      </div>

      <p className="text-sm text-gray-700 leading-relaxed mb-4">{summary.call_summary}</p>

      <div className="border border-[var(--border)] rounded-lg overflow-hidden">
        <button
          onClick={onToggleJson}
          className="w-full px-3 py-2 text-left text-sm font-medium text-gray-600 hover:bg-gray-50 transition-colors flex items-center justify-between"
        >
          Raw JSON
          <ChevronDown className={`w-4 h-4 transition-transform ${showJson ? 'rotate-180' : ''}`} />
        </button>
        {showJson && (
          <pre className="bg-gray-950 text-gray-100 text-xs font-mono p-4 overflow-x-auto leading-relaxed">
            <code>{JSON.stringify(summary, null, 2)}</code>
          </pre>
        )}
      </div>

      <div className="flex gap-3 mt-4 pt-4 border-t border-[var(--border)]">
        <button
          onClick={onDownload}
          className="flex-1 px-4 py-2.5 text-sm font-medium text-teal-600 hover:text-teal-700 hover:underline transition-colors"
        >
          Download Transcript
        </button>
        <button
          onClick={onNewCall}
          className="flex-1 px-4 py-2.5 text-sm font-medium text-gray-500 hover:text-gray-700 transition-colors"
        >
          New Call
        </button>
      </div>
    </div>
  );
}

function OrderCard({ order }: { order: typeof testOrders[0] }) {
  return (
    <div className="group relative bg-white/80 backdrop-blur-sm border border-[var(--border)] rounded-xl p-4 transition-all duration-200 hover:shadow-lg hover:border-teal-200">
      <div className="flex items-start justify-between gap-2">
        <span className="text-base font-semibold text-gray-900">{order.id}</span>
        <span className={`px-2.5 py-1 text-xs font-medium rounded-full ${order.statusColor} shrink-0`}>
          {order.status}
        </span>
      </div>
      <p className="text-base text-gray-700 mt-2">{order.customer}</p>
      <p className="text-sm text-gray-500 mt-1">{order.product}</p>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-3 pt-3 border-t border-gray-100">
        <span className="text-base font-semibold text-gray-900">₹{order.price}</span>
        <span className="text-xs text-gray-400">· {order.note}</span>
      </div>
    </div>
  );
}

function RightColumn() {
  return (
    <div className="w-full lg:w-[360px] flex-shrink-0 bg-[var(--panel-bg)] lg:border-l lg:border-[var(--border)] overflow-y-auto p-4 sm:p-6">
      <div className="mb-8">
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Test Orders</h4>
        </div>
        <p className="text-sm text-gray-500 mb-4">Use these order IDs to test the agent.</p>
        <div className="space-y-3">
          {testOrders.map((order) => (
            <OrderCard key={order.id} order={order} />
          ))}
        </div>
      </div>

      <div className="mb-8">
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Try Asking</h4>
        <div className="space-y-2">
          {suggestedPrompts.map((prompt) => (
            <div key={prompt} className="flex items-center gap-2 text-sm text-gray-500 p-2 rounded-lg hover:bg-white/50 transition-colors">
              <span className="text-gray-300">›</span>
              <span className="font-medium text-gray-600 truncate">"{prompt}"</span>
            </div>
          ))}
        </div>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Brand Policies</h4>
        <div className="text-sm text-gray-500 leading-relaxed space-y-2">
          <p>Shipping: Free above ₹499 · 3–5 business days</p>
          <p>Returns: 7 days · Unopened only</p>
          <p>Cancellation: Processing status only</p>
          <p>COD: Up to ₹2,500</p>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [showRawJson, setShowRawJson] = useState(false);
  const [connectionState, setConnectionState] = useState<'idle' | 'listening' | 'thinking' | 'speaking' | 'connecting' | 'error'>('idle');
  const [micPermissionDenied, setMicPermissionDenied] = useState(false);
  const [volumeLevel, setVolumeLevel] = useState(0);
  const [showSummary, setShowSummary] = useState(false);
  
  const {
    startCall,
    endCall,
    reconnect,
    callState,
    transcript,
    callSummary,
    callDuration,
    connectionError
  } = useVoiceAgent();

  useEffect(() => {
    if (connectionError) {
      setConnectionState('error');
      if (connectionError.includes('permission') || connectionError.includes('denied')) {
        setMicPermissionDenied(true);
      }
    } else if (callState === 'idle') {
      setConnectionState('idle');
    } else if (callState === 'listening') {
      setConnectionState('listening');
    } else if (callState === 'thinking') {
      setConnectionState('thinking');
    } else if (callState === 'speaking') {
      setConnectionState('speaking');
    }
  }, [callState, connectionError]);

  useEffect(() => {
    if (callSummary && !callState) {
      setShowSummary(true);
    }
  }, [callSummary, callState]);

  useEffect(() => {
    if (callState === 'listening') {
      const interval = setInterval(() => {
        setVolumeLevel(Math.floor(Math.random() * 5) + 1);
      }, 200);
      return () => clearInterval(interval);
    }
    setVolumeLevel(0);
  }, [callState]);

  const isInCall = callState !== 'idle';
  const isConnecting = connectionState === 'connecting';

  const downloadTranscript = useCallback(() => {
    if (!callSummary) return;
    const lines = [
      '=== Aura Skincare - Call Transcript ===',
      `Date: ${new Date().toLocaleDateString('en-US')}`,
      `Duration: ${formatTime(callSummary.call_duration_seconds)}`,
      `Intent: ${getIntentText(callSummary.customer_intent)}`,
      `Order ID: ${callSummary.order_id || 'N/A'}`,
      `Customer: ${callSummary.customer_name || 'N/A'}`,
      `Resolution: ${getStatusText(callSummary.resolution_status)}`,
      `Sentiment: ${getSentimentText(callSummary.sentiment)}`,
      `Follow-up Required: ${callSummary.follow_up_required ? 'Yes' : 'No'}`,
      '',
      '=== TRANSCRIPT ===',
      '',
      ...transcript.map(t => `[${formatTimestamp(t.timestamp)}] ${t.speaker === 'customer' ? 'You' : 'Aria'}: ${t.text}`),
      '',
      '=== SUMMARY ===',
      callSummary.call_summary,
      '',
      '=== ACTION TAKEN ===',
      callSummary.action_taken,
    ];
    const content = lines.join('\n');
    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `aura-call-${callSummary.order_id || 'transcript'}-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [callSummary, transcript]);

  const handleNewCall = () => {
    window.location.reload();
  };

  const handleStartCall = async () => {
    setMicPermissionDenied(false);
    setConnectionState('connecting');
    try {
      await startCall();
    } catch {
      setConnectionState('error');
    }
  };

  const handleEndCall = () => {
    endCall();
    setConnectionState('idle');
  };

  const handleReconnect = () => {
    setConnectionState('connecting');
    reconnect();
    setTimeout(() => setConnectionState('idle'), 1000);
  };

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Gradient Header */}
      <header className="border-b border-[var(--border)] bg-gradient-to-r from-teal-50 to-white flex-shrink-0">
        <div className="max-w-7xl mx-auto px-4 py-3 sm:px-6 lg:px-8 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500 to-teal-700 flex items-center justify-center shadow-lg shadow-teal-500/25">
              <span className="text-xl">🌿</span>
            </div>
            <div>
              <h1 className="text-lg sm:text-xl font-semibold text-gray-900">Aura Skincare</h1>
              <p className="text-xs text-gray-500">AI Voice Support Agent</p>
            </div>
            <span className="px-2.5 py-0.5 text-[11px] font-medium bg-teal-50 text-teal-700 rounded-full">
              Voice Support
            </span>
          </div>
          <a
            href="https://github.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-gray-400 hover:text-gray-600 transition-colors flex items-center gap-1"
          >
            <ExternalLink className="w-4 h-4" />
            GitHub
          </a>
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 flex flex-col overflow-hidden lg:flex-row">
        {/* Left Column */}
        <div className="flex-1 min-w-0 flex flex-col border-r border-[var(--border)] lg:border-b-0 bg-white">
          {/* Section A - Call Controls */}
          <section className="p-4 sm:p-6 lg:p-8 border-b border-[var(--border)] flex-shrink-0">
            <div className="flex items-center justify-between mb-6">
              <StatusIndicator state={connectionState} />
              <span className="text-sm font-mono text-gray-400 tabular-nums px-3 py-1 bg-gray-50 rounded-lg">
                {formatTime(callDuration)}
              </span>
            </div>
            
            <div className="max-w-xs mx-auto sm:max-w-sm lg:max-w-md">
              <CallButton
                state={connectionError ? 'error' : isConnecting ? 'connecting' : isInCall ? callState : 'idle'}
                onClick={connectionError || isConnecting ? handleReconnect : isInCall ? handleEndCall : handleStartCall}
                disabled={isConnecting || (isInCall && callState === 'speaking')}
              />
              
              {micPermissionDenied && (
                <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2">
                  <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
                  <div className="text-sm text-red-700">
                    <p className="font-medium">Microphone access denied</p>
                    <p>Please enable microphone permissions in your browser settings and refresh.</p>
                  </div>
                </div>
              )}
              
              {!micPermissionDenied && !isInCall && (
                <p className="mt-3 text-sm text-gray-400 text-center">
                  Microphone access required. Works best in Chrome.
                </p>
              )}
              
              {isInCall && callState === 'listening' && (
                <div className="mt-4 flex items-center justify-center gap-2">
                  <VolumeIndicator level={volumeLevel} />
                  <span className="text-xs text-gray-400">Voice detected</span>
                </div>
              )}
              
              {isInCall && callState === 'thinking' && (
                <div className="mt-4 text-center">
                  <span className="text-sm text-amber-600 flex items-center justify-center gap-1">
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" />
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                    AI is thinking…
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Section B - Live Transcript */}
          <section className="flex-1 overflow-hidden flex flex-col">
            <div className="px-4 py-3 border-b border-[var(--border)] sm:px-6 lg:px-8">
              <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400">Transcript</h4>
            </div>
            <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6 lg:px-8">
              <TranscriptView transcript={transcript} isInCall={isInCall} />
            </div>
          </section>

          {/* Section C - Post-Call Summary */}
          {callSummary && !isInCall && (
            <CallSummaryView
              summary={callSummary}
              transcript={transcript}
              onDownload={downloadTranscript}
              onNewCall={handleNewCall}
              onToggleJson={() => setShowRawJson(!showRawJson)}
              showJson={showRawJson}
            />
          )}
        </div>

        {/* Right Column */}
        <RightColumn />
      </div>
    </div>
  );
}