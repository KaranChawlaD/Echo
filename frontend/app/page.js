"use client"

import { useState, useEffect, useRef } from 'react';
import { Phone, Download, MessageSquare, Heart, Clock, CheckCircle, AlertCircle, RefreshCw, Volume2, VolumeX, Headphones } from 'lucide-react';

export default function Dashboard() {
  const [helpRequest, setHelpRequest] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [callStatus, setCallStatus] = useState('idle'); // idle, calling, completed, error
  const [transcript, setTranscript] = useState(null);
  const [callId, setCallId] = useState(null);
  const [debugInfo, setDebugInfo] = useState(''); 
  const [pollCount, setPollCount] = useState(0);
  const [listenUrl, setListenUrl] = useState(null);
  const [isListening, setIsListening] = useState(false);
  const [showListenModal, setShowListenModal] = useState(false);
  const [liveMessages, setLiveMessages] = useState([]);
  const [callDuration, setCallDuration] = useState(0);
  const [isCallConnected, setIsCallConnected] = useState(false);
  
  // Refs for WebSocket and audio
  const wsRef = useRef(null);
  const audioContextRef = useRef(null);
  const audioPlayerRef = useRef(null);
  const callStartTimeRef = useRef(null);

  const addDebugInfo = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugInfo(prev => `${prev}\n[${timestamp}] ${message}`);
    console.log(`[${timestamp}] ${message}`);
  };

  // WebSocket connection for real-time updates
  useEffect(() => {
    if (callStatus === 'calling') {
      const ws = new WebSocket('ws://localhost:3002/ws');
      wsRef.current = ws;

      ws.onopen = () => {
        addDebugInfo('WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          addDebugInfo(`WebSocket message: ${data.type}`);
          
          // Only handle events for our current call
          if (data.callId && data.callId !== callId) {
            return;
          }

          switch (data.type) {
            case 'ringing':
              addDebugInfo('Call is ringing...');
              setLiveMessages(prev => [...prev, 'Call is ringing...']);
              setIsCallConnected(false);
              break;
              
            case 'in-progress':
              addDebugInfo('Call connected and in progress');
              setLiveMessages(prev => [...prev, 'Call connected - conversation in progress']);
              setIsCallConnected(true);
              if (!callStartTimeRef.current) {
                callStartTimeRef.current = Date.now();
              }
              break;
              
            case 'message':
              const speaker = data.role === 'assistant' ? 'AI Agent' : 'Support Person';
              const messageText = `${speaker}: ${data.text}`;
              setLiveMessages(prev => [...prev, messageText]);
              addDebugInfo(`New message: ${messageText}`);
              break;
              
            case 'call_ended':
              addDebugInfo('Call ended');
              setLiveMessages(prev => [...prev, 'Call completed - processing results...']);
              setIsCallConnected(false);
              callStartTimeRef.current = null;
              break;
              
            case 'transcript_ready':
              addDebugInfo('Transcript ready');
              setCallStatus('completed');
              setTranscript(data.transcript);
              break;
              
            case 'call_error':
              addDebugInfo(`Call error: ${data.error}`);
              setCallStatus('error');
              break;
          }
        } catch (e) {
          addDebugInfo(`Error parsing WebSocket message: ${e.message}`);
        }
      };

      ws.onclose = () => {
        addDebugInfo('WebSocket disconnected');
        wsRef.current = null;
      };

      ws.onerror = (error) => {
        addDebugInfo(`WebSocket error: ${error}`);
      };

      return () => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.close();
        }
      };
    }
  }, [callStatus, callId]);

  // Call duration timer
  useEffect(() => {
    let interval;
    if (isCallConnected && callStartTimeRef.current) {
      interval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - callStartTimeRef.current) / 1000);
        setCallDuration(elapsed);
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isCallConnected]);

  const formatDuration = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const handleSubmitRequest = async () => {
    if (!helpRequest.trim()) return;
    
    setIsLoading(true);
    setCallStatus('calling');
    setDebugInfo('');
    setPollCount(0);
    setLiveMessages([]);
    setCallDuration(0);
    callStartTimeRef.current = null;
    addDebugInfo('Starting call request...');
    
    try {
      const response = await fetch('http://localhost:3002/api/initiate-call', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          helpRequest: helpRequest.trim(),
        }),
      });
      
      const data = await response.json();
      addDebugInfo(`API Response: ${JSON.stringify(data)}`);
      
      if (response.ok && data.callId) {
        setCallId(data.callId);
        setListenUrl(data.listenUrl);
        addDebugInfo(`Call ID set: ${data.callId}`);
        if (data.listenUrl) {
          addDebugInfo(`Listen URL available: ${data.listenUrl}`);
        }
        
        setLiveMessages(['Call initiated successfully', 'AI agent is connecting...']);
        
        // Start fallback polling in case WebSocket fails
        setTimeout(() => pollCallStatus(data.callId), 5000);
      } else {
        addDebugInfo(`Invalid response: ${JSON.stringify(data)}`);
        throw new Error(data.error || 'Failed to initiate call - no call ID returned');
      }
    } catch (error) {
      addDebugInfo(`Error initiating call: ${error.message}`);
      setCallStatus('error');
    } finally {
      setIsLoading(false);
    }
  };

  const pollCallStatus = async (callId) => {
    if (!callId || callStatus === 'completed') {
      return;
    }
    
    try {
      setPollCount(prev => prev + 1);
      addDebugInfo(`Fallback polling attempt #${pollCount + 1} for call ${callId}`);
      
      const response = await fetch(`http://localhost:3002/api/call-status/${callId}`);
      const data = await response.json();
      
      addDebugInfo(`Status response: ${JSON.stringify(data)}`);
      
      if (response.ok) {
        if (data.status === 'completed' && callStatus !== 'completed') {
          addDebugInfo('Call completed via polling! Setting transcript...');
          setCallStatus('completed');
          setTranscript(data.transcript);
        } else if (data.status === 'error' || data.status === 'failed') {
          addDebugInfo(`Call failed with status: ${data.status}`);
          setCallStatus('error');
        } else if (callStatus === 'calling') {
          // Continue polling for other statuses
          setTimeout(() => pollCallStatus(callId), 3000);
        }
      } else {
        addDebugInfo(`Status check failed: ${JSON.stringify(data)}`);
      }
    } catch (error) {
      addDebugInfo(`Error checking call status: ${error.message}`);
      if (pollCount < 10 && callStatus === 'calling') {
        setTimeout(() => pollCallStatus(callId), 5000);
      }
    }
  };

  const startListening = async () => {
    if (!listenUrl) {
      addDebugInfo('No listen URL available');
      return;
    }

    try {
      addDebugInfo(`Starting to listen to call: ${listenUrl}`);
      setShowListenModal(true);
      setIsListening(true);

      // Initialize audio context
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      audioContextRef.current = audioContext;

      // Connect to the listen WebSocket
      const audioWs = new WebSocket(listenUrl);
      audioWs.binaryType = "blob";

      audioWs.onopen = () => {
        addDebugInfo('Audio WebSocket connected');
      };

      audioWs.onmessage = async (event) => {
        if (typeof event.data === "string") {
          // Handle initial metadata JSON
          const message = JSON.parse(event.data);
          addDebugInfo(`Audio stream message: ${JSON.stringify(message)}`);
          
          if (message.type === "start") {
            addDebugInfo("Audio stream starting...");
          }
        } else if (event.data instanceof Blob) {
          // Handle PCM audio data
          try {
            const arrayBuffer = await event.data.arrayBuffer();
            
            // Convert PCM data to audio buffer
            // const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

            const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
            const decodedData = await audioCtx.decodeAudioData(arrayBuffer);
            
            // Play the audio
            const source = audioContext.createBufferSource();
            source.buffer = decodedData;
            source.connect(audioContext.destination);
            source.start(0);
            
          } catch (audioError) {
            console.error('Error processing audio:', audioError);
          }
        }
      };

      audioWs.onclose = () => {
        addDebugInfo('Audio WebSocket closed');
        setIsListening(false);
      };

      audioWs.onerror = (error) => {
        addDebugInfo(`Audio WebSocket error: ${error}`);
        setIsListening(false);
      };

      audioPlayerRef.current = audioWs;

    } catch (error) {
      addDebugInfo(`Error starting audio stream: ${error.message}`);
      setIsListening(false);
    }
  };

  const stopListening = () => {
    if (audioPlayerRef.current) {
      audioPlayerRef.current.close();
      audioPlayerRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    setIsListening(false);
    setShowListenModal(false);
    addDebugInfo('Stopped listening to call');
  };

  const endCall = async () => {
    if (!callId) return;
    
    try {
      addDebugInfo('Ending call...');
      const response = await fetch(`http://localhost:3002/api/end-call/${callId}`, {
        method: 'POST'
      });

      if (response.ok) {
        addDebugInfo('Call ended successfully');
        setLiveMessages(prev => [...prev, 'Call ended by user']);
      } else {
        addDebugInfo('Failed to end call');
      }
    } catch (error) {
      addDebugInfo(`Error ending call: ${error.message}`);
    }
  };

  const downloadTranscript = () => {
    if (!transcript) return;
    
    const blob = new Blob([transcript], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `support-call-transcript-${new Date().toISOString().split('T')[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addDebugInfo('Transcript downloaded');
  };

  const resetForm = () => {
    setHelpRequest('');
    setCallStatus('idle');
    setTranscript(null);
    setCallId(null);
    setListenUrl(null);
    setDebugInfo('');
    setPollCount(0);
    setLiveMessages([]);
    setCallDuration(0);
    setIsCallConnected(false);
    callStartTimeRef.current = null;
    stopListening();
    addDebugInfo('Form reset');
  };

  const testConnection = async () => {
    try {
      addDebugInfo('Testing backend connection...');
      const response = await fetch('http://localhost:3002/api/health');
      const data = await response.json();
      addDebugInfo(`Health check response: ${JSON.stringify(data)}`);
    } catch (error) {
      addDebugInfo(`Health check failed: ${error.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-3">
            <div className="flex items-center justify-center gap-3 mb-4">
              <h1 className="text-6xl font-bold text-[#da63e1]">Echo</h1>
            </div>
            <p className="text-lg text-[#03060f] max-w-2xl mx-auto">
              When asking for help feels difficult, let our AI agent speak for you. 
            </p>
          </div>

          {/* Status indicator at top */}
          <div className="mb-5 text-center">
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-full shadow-sm">
              <div className={`w-2 h-2 rounded-full ${
                callStatus === 'idle' ? 'bg-gray-400' :
                callStatus === 'calling' ? 'bg-yellow-400 animate-pulse' :
                callStatus === 'completed' ? 'bg-green-400' :
                'bg-red-400'
              }`}></div>
              <span className="text-sm text-gray-600 capitalize">
                {callStatus === 'idle' ? 'Ready' : 
                 callStatus === 'calling' ? 'Calling in progress' :
                 callStatus === 'completed' ? 'Call completed' :
                 'Call failed'}
              </span>
              {isCallConnected && (
                <span className="text-xs text-gray-500">
                  {formatDuration(callDuration)}
                </span>
              )}
              {callId && (
                <span className="text-xs text-gray-400">
                  ID: {callId.substring(0, 8)}...
                </span>
              )}
            </div>
          </div>

          {/* Main Content */}
          <div className="bg-[#f3f6ff] rounded-xl shadow-lg p-8">
            {callStatus === 'idle' && (
              <div className="space-y-6">
                <div>
                  <label htmlFor="helpRequest" className="block text-lg font-medium text-[#03060f] mb-3">
                    What help do you need?
                  </label>
                  <textarea
                    id="helpRequest"
                    value={helpRequest}
                    onChange={(e) => setHelpRequest(e.target.value)}
                    placeholder="Describe the support or help you're looking for. Our AI agent will communicate this on your behalf to a desired phone number."
                    className="w-full h-40 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-[#3b5bd9] focus:outline-none focus:border-transparent resize-none text-[#03060f]"
                  />
                </div>
                
                <div className="flex justify-center">
                  <button
                    onClick={handleSubmitRequest}
                    disabled={!helpRequest.trim() || isLoading}
                    className="flex items-center gap-3 px-8 py-3 bg-[#3b5bd9] text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                  >
                    <Phone className="w-5 h-5" />
                    {isLoading ? 'Initiating Call...' : 'Request Support Call'}
                  </button>
                </div>
              </div>
            )}

            {callStatus === 'calling' && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="flex justify-center mb-4">
                    <div className="animate-pulse">
                      <Phone className="w-16 h-16 text-blue-500" />
                    </div>
                  </div>
                  <h3 className="text-2xl font-semibold text-gray-800 mb-2">
                    Call in Progress
                  </h3>
                  <p className="text-gray-600 mb-4">
                    Our AI agent is currently speaking with your support person on your behalf...
                  </p>
                  
                  {isCallConnected && (
                    <div className="flex items-center justify-center gap-4 mb-4">
                      <div className="flex items-center gap-2 text-sm text-green-600">
                        <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                        <span>Connected • {formatDuration(callDuration)}</span>
                      </div>
                    </div>
                  )}
                  
                  {!isCallConnected && (
                    <div className="flex items-center justify-center gap-2 text-sm text-gray-500 mb-4">
                      <Clock className="w-4 h-4" />
                      <span>Connecting...</span>
                    </div>
                  )}
                </div>

                {/* Call Controls */}
                <div className="flex justify-center gap-4 mb-6">
                  {listenUrl && (
                    <button
                      onClick={isListening ? stopListening : startListening}
                      className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      {isListening ? <VolumeX className="w-4 h-4" /> : <Headphones className="w-4 h-4" />}
                      {isListening ? 'Stop Listening' : 'Listen to Call'}
                    </button>
                  )}
                  
                  <button
                    onClick={endCall}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    <Phone className="w-4 h-4" />
                    End Call
                  </button>
                </div>

                <div className="bg-blue-50 p-4 rounded-lg mb-4">
                  <p className="text-sm text-blue-800">
                    <strong>Your Request:</strong> "{helpRequest}"
                  </p>
                </div>

                {/* Live Messages */}
                {liveMessages.length > 0 && (
                  <div className="bg-white p-4 rounded-lg border">
                    <h4 className="font-medium text-gray-800 mb-3 flex items-center gap-2">
                      <MessageSquare className="w-4 h-4" />
                      Live Updates
                    </h4>
                    <div className="space-y-2 max-h-60 overflow-y-auto">
                      {liveMessages.map((message, index) => (
                        <div key={index} className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                          {message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                
                {/* Progress indicator */}
                <div className="w-full bg-gray-200 rounded-full h-2">
                  <div className="bg-blue-600 h-2 rounded-full animate-pulse" style={{width: '60%'}}></div>
                </div>
              </div>
            )}

            {callStatus === 'completed' && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="flex justify-center mb-4">
                    <CheckCircle className="w-16 h-16 text-green-500" />
                  </div>
                  <h3 className="text-2xl font-semibold text-gray-800 mb-2">
                    Call Completed Successfully
                  </h3>
                  <p className="text-gray-600">
                    Your support request has been communicated. The conversation transcript is ready for download.
                  </p>
                </div>

                <div className="bg-green-50 border border-green-200 rounded-lg p-6">
                  <h4 className="font-semibold text-green-800 mb-3">Call Summary</h4>
                  <p className="text-green-700 mb-4">
                    Our AI agent successfully conveyed your request for help and received a supportive response.
                  </p>
                  
                  {transcript && (
                    <div className="bg-white p-4 rounded border mb-4">
                      <h5 className="font-medium text-gray-800 mb-2">Transcript Preview:</h5>
                      <p className="text-sm text-gray-600 line-clamp-3">
                        {transcript.substring(0, 200)}...
                      </p>
                    </div>
                  )}
                  
                  <div className="flex gap-4 justify-center">
                    <button
                      onClick={downloadTranscript}
                      disabled={!transcript}
                      className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Download Transcript
                    </button>
                    
                    <button
                      onClick={resetForm}
                      className="flex items-center gap-2 px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      <RefreshCw className="w-4 h-4" />
                      New Request
                    </button>
                  </div>
                </div>

                {/* Show final live messages */}
                {liveMessages.length > 0 && (
                  <div className="bg-white p-4 rounded-lg border">
                    <h4 className="font-medium text-gray-800 mb-3">Call Log</h4>
                    <div className="space-y-2 max-h-40 overflow-y-auto">
                      {liveMessages.map((message, index) => (
                        <div key={index} className="text-sm text-gray-600 p-2 bg-gray-50 rounded">
                          {message}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {callStatus === 'error' && (
              <div className="text-center space-y-6">
                <div className="flex justify-center mb-4">
                  <AlertCircle className="w-16 h-16 text-red-500" />
                </div>
                <div className="text-red-500">
                  <h3 className="text-2xl font-semibold mb-2">Call Failed</h3>
                  <p className="text-gray-600 mb-4">
                    We encountered an issue while trying to make the support call. Please try again.
                  </p>
                </div>
                
                <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                  <p className="text-sm text-red-800 mb-3">
                    <strong>Troubleshooting tips:</strong>
                  </p>
                  <ul className="text-sm text-red-700 text-left max-w-md mx-auto space-y-1">
                    <li>• Check that the backend server is running on port 3002</li>
                    <li>• Verify your environment variables are set correctly</li>
                    <li>• Try enabling MOCK_MODE=true for testing</li>
                    <li>• Check the debug info below for specific error details</li>
                  </ul>
                </div>
                
                <div className="flex gap-4 justify-center">
                  <button
                    onClick={testConnection}
                    className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                  >
                    Test Connection
                  </button>
                  <button
                    onClick={resetForm}
                    className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    Try Again
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Audio Listening Modal */}
          {showListenModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg p-6 max-w-md w-full mx-4">
                <div className="text-center">
                  <div className="flex justify-center mb-4">
                    {isListening ? (
                      <Volume2 className="w-12 h-12 text-green-500 animate-pulse" />
                    ) : (
                      <VolumeX className="w-12 h-12 text-gray-400" />
                    )}
                  </div>
                  <h3 className="text-xl font-semibold mb-2">
                    {isListening ? 'Listening to Call' : 'Audio Disconnected'}
                  </h3>
                  <p className="text-gray-600 mb-6">
                    {isListening 
                      ? 'You can now hear the live conversation between the AI agent and support person.'
                      : 'The audio connection has been lost or stopped.'
                    }
                  </p>
                  <div className="flex gap-3 justify-center">
                    <button
                      onClick={stopListening}
                      className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      Close
                    </button>
                    {!isListening && (
                      <button
                        onClick={startListening}
                        className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                      >
                        Reconnect
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Debug Panel */}
          {debugInfo && process.env.NODE_ENV === 'development' && (
            <div className="mt-6 bg-gray-100 border rounded-lg p-4">
              <div className="flex justify-between items-center mb-2">
                <h4 className="font-medium text-gray-700">Debug Info</h4>
                <button 
                  onClick={testConnection}
                  className="text-sm px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Test Connection
                </button>
              </div>
              <pre className="text-xs text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto bg-white p-2 rounded border">
                {debugInfo}
              </pre>
            </div>
          )}

          {/* Info Section */}
          <div className="mt-8 bg-white/50 backdrop-blur rounded-lg p-6 shadow-lg">
            <h3 className="text-lg text-center text-gray-800 mb-3">How it works</h3>
            <div className="grid md:grid-cols-3 gap-4 text-sm text-gray-600">
              <div className="text-center">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-[#3b5bd9] font-semibold">1</span>
                </div>
                <p>Describe the help you need</p>
              </div>
              <div className="text-center">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-[#3b5bd9] font-semibold">2</span>
                </div>
                <p>Our AI agent calls your support person</p>
              </div>
              <div className="text-center">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-[#3b5bd9] font-semibold">3</span>
                </div>
                <p>Listen live and receive a full transcript</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}