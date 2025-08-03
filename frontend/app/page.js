"use client"

import { useState } from 'react';
import { Phone, Download, MessageSquare, Heart, Clock, CheckCircle, AlertCircle, RefreshCw } from 'lucide-react';

export default function Dashboard() {
  const [helpRequest, setHelpRequest] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [callStatus, setCallStatus] = useState('idle'); // idle, calling, completed, error
  const [transcript, setTranscript] = useState(null);
  const [callId, setCallId] = useState(null);
  const [debugInfo, setDebugInfo] = useState(''); // For debugging
  const [pollCount, setPollCount] = useState(0); // Track polling attempts

  const addDebugInfo = (message) => {
    const timestamp = new Date().toLocaleTimeString();
    setDebugInfo(prev => `${prev}\n[${timestamp}] ${message}`);
    console.log(`[${timestamp}] ${message}`);
  };

  const handleSubmitRequest = async () => {
    if (!helpRequest.trim()) return;
    
    setIsLoading(true);
    setCallStatus('calling');
    setDebugInfo('');
    setPollCount(0);
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
        addDebugInfo(`Call ID set: ${data.callId}`);
        // Poll for call completion
        pollCallStatus(data.callId);
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
    if (!callId) {
      addDebugInfo('No call ID provided for polling');
      setCallStatus('error');
      return;
    }
    
    addDebugInfo(`Starting to poll call status for ID: ${callId}`);
    
    const checkStatus = async () => {
      try {
        setPollCount(prev => prev + 1);
        addDebugInfo(`Polling attempt #${pollCount + 1} for call ${callId}`);
        
        const response = await fetch(`http://localhost:3002/api/call-status/${callId}`);
        const data = await response.json();
        
        addDebugInfo(`Status response: ${JSON.stringify(data)}`);
        
        if (response.ok) {
          if (data.status === 'completed') {
            addDebugInfo('Call completed! Setting transcript...');
            setCallStatus('completed');
            setTranscript(data.transcript);
          } else if (data.status === 'error' || data.status === 'failed') {
            addDebugInfo(`Call failed with status: ${data.status}`);
            setCallStatus('error');
          } else {
            // Continue polling for other statuses
            addDebugInfo(`Call still in progress (${data.status}), continuing to poll...`);
            setTimeout(checkStatus, 2000); // Poll every 2 seconds
          }
        } else {
          addDebugInfo(`Status check failed: ${JSON.stringify(data)}`);
          setCallStatus('error');
        }
      } catch (error) {
        addDebugInfo(`Error checking call status: ${error.message}`);
        // Don't immediately set error status on network issues, retry a few times
        if (pollCount < 10) {
          setTimeout(checkStatus, 3000);
        } else {
          setCallStatus('error');
        }
      }
    };
    
    checkStatus();
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
    setDebugInfo('');
    setPollCount(0);
    addDebugInfo('Form reset');
  };

  // Test connection function
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
              {/* <Heart className="w-8 h-8 text-red-500" /> */}
              <h1 className="text-6xl font-bold text-[#da63e1]">Echo</h1>
            </div>
            <p className="text-lg text-[#03060f] max-w-2xl mx-auto">
              When asking for help feels difficult, let our AI agent speak for you. 
            </p>
          </div>

          {/* Debug Panel (shows in development) */}
          {/* {debugInfo && (
            <div className="mb-6 bg-gray-100 border rounded-lg p-4">
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
          )} */}

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
              <div className="text-center space-y-6">
                <div className="flex justify-center">
                  <div className="animate-pulse">
                    <Phone className="w-16 h-16 text-blue-500" />
                  </div>
                </div>
                <div>
                  <h3 className="text-2xl font-semibold text-gray-800 mb-2">
                    Call in Progress
                  </h3>
                  <p className="text-gray-600 mb-4">
                    Our AI agent is currently speaking with your support person on your behalf...
                  </p>
                  <div className="flex items-center justify-center gap-2 text-sm text-gray-500">
                    <Clock className="w-4 h-4" />
                    <span>Poll attempt #{pollCount}</span>
                  </div>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>Your Request:</strong> "{helpRequest}"
                  </p>
                </div>
                
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
                      <p className="text-sm text-gray-600 line-clamp-5">
                        {transcript.substring(100, 600)}...
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
                    <li>• Check the debug info above for specific error details</li>
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
                <p>Receive a full overview of the conversation</p>
              </div>
            </div>
          </div>

          
        </div>
      </div>
    </div>
  );
}