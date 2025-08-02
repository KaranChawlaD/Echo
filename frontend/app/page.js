'use client';

import { useState } from 'react';
import { Phone, Download, MessageSquare, Heart } from 'lucide-react';

export default function Dashboard() {
  const [helpRequest, setHelpRequest] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [callStatus, setCallStatus] = useState('idle'); // idle, calling, completed, error
  const [transcript, setTranscript] = useState(null);
  const [callId, setCallId] = useState(null);

  const handleSubmitRequest = async () => {
    if (!helpRequest.trim()) return;
    
    setIsLoading(true);
    setCallStatus('calling');
    
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
      console.log('API Response:', data); // Debug log
      
      if (response.ok && data.callId) {
        setCallId(data.callId);
        console.log('Call ID set:', data.callId); // Debug log
        // Poll for call completion
        pollCallStatus(data.callId);
      } else {
        console.error('Invalid response:', data);
        throw new Error(data.error || 'Failed to initiate call - no call ID returned');
      }
    } catch (error) {
      console.error('Error initiating call:', error);
      setCallStatus('error');
    } finally {
      setIsLoading(false);
    }
  };

  const pollCallStatus = async (callId) => {
    if (!callId) {
      console.error('No call ID provided for polling');
      setCallStatus('error');
      return;
    }
    
    console.log('Polling call status for ID:', callId); // Debug log
    
    const checkStatus = async () => {
      try {
        const response = await fetch(`http://localhost:3002/api/call-status/${callId}`);
        const data = await response.json();
        
        console.log('Status check response:', data); // Debug log
        
        if (response.ok) {
          if (data.status === 'completed') {
            setCallStatus('completed');
            setTranscript(data.transcript);
          } else if (data.status === 'failed' || data.status === 'error') {
            setCallStatus('error');
          } else if (data.status === 'in_progress' || data.status === 'calling') {
            // Continue polling
            setTimeout(checkStatus, 3000);
          } else {
            // Continue polling for other statuses
            setTimeout(checkStatus, 3000);
          }
        } else {
          console.error('Status check failed:', data);
          setCallStatus('error');
        }
      } catch (error) {
        console.error('Error checking call status:', error);
        setCallStatus('error');
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
  };

  const resetForm = () => {
    setHelpRequest('');
    setCallStatus('idle');
    setTranscript(null);
    setCallId(null);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="text-center mb-8">
            <div className="flex items-center justify-center gap-3 mb-4">
              <Heart className="w-8 h-8 text-red-500" />
              <h1 className="text-4xl font-bold text-gray-800">Support Bridge</h1>
            </div>
            <p className="text-lg text-gray-600 max-w-2xl mx-auto">
              When asking for help feels difficult, let our AI agent speak for you. 
              Your request will be conveyed with care and empathy.
            </p>
          </div>

          {/* Main Content */}
          <div className="bg-white rounded-xl shadow-lg p-8">
            {callStatus === 'idle' && (
              <div className="space-y-6">
                <div>
                  <label htmlFor="helpRequest" className="block text-lg font-medium text-gray-700 mb-3">
                    What help do you need?
                  </label>
                  <textarea
                    id="helpRequest"
                    value={helpRequest}
                    onChange={(e) => setHelpRequest(e.target.value)}
                    placeholder="Describe the support or help you're looking for. Our AI agent will communicate this on your behalf with understanding and respect..."
                    className="w-full h-40 p-4 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none text-gray-700"
                  />
                </div>
                
                <div className="flex justify-center">
                  <button
                    onClick={handleSubmitRequest}
                    disabled={!helpRequest.trim() || isLoading}
                    className="flex items-center gap-3 px-8 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
                  <p className="text-gray-600">
                    Our AI agent is currently speaking with your support person on your behalf...
                  </p>
                </div>
                <div className="bg-blue-50 p-4 rounded-lg">
                  <p className="text-sm text-blue-800">
                    <strong>Your Request:</strong> "{helpRequest}"
                  </p>
                </div>
              </div>
            )}

            {callStatus === 'completed' && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="flex justify-center mb-4">
                    <MessageSquare className="w-16 h-16 text-green-500" />
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
                  
                  <div className="flex gap-4 justify-center">
                    <button
                      onClick={downloadTranscript}
                      className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                    >
                      <Download className="w-4 h-4" />
                      Download Transcript
                    </button>
                    
                    <button
                      onClick={resetForm}
                      className="flex items-center gap-2 px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                    >
                      New Request
                    </button>
                  </div>
                </div>
              </div>
            )}

            {callStatus === 'error' && (
              <div className="text-center space-y-6">
                <div className="text-red-500">
                  <h3 className="text-2xl font-semibold mb-2">Call Failed</h3>
                  <p className="text-gray-600">
                    We encountered an issue while trying to make the support call. Please try again.
                  </p>
                </div>
                
                <button
                  onClick={resetForm}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}
          </div>

          {/* Info Section */}
          <div className="mt-8 bg-white/50 backdrop-blur rounded-lg p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-3">How it works</h3>
            <div className="grid md:grid-cols-3 gap-4 text-sm text-gray-600">
              <div className="text-center">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-blue-600 font-semibold">1</span>
                </div>
                <p>Describe the help you need in your own words</p>
              </div>
              <div className="text-center">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-blue-600 font-semibold">2</span>
                </div>
                <p>Our AI agent calls your support person and explains your situation</p>
              </div>
              <div className="text-center">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-2">
                  <span className="text-blue-600 font-semibold">3</span>
                </div>
                <p>Receive a full transcript of the supportive conversation</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}