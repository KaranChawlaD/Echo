const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const WebSocket = require('ws');
const http = require('http');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const PORT = process.env.PORT || 3002;

// Create recordings directory if it doesn't exist
const recordingsDir = path.join(__dirname, 'recordings');
if (!fs.existsSync(recordingsDir)) {
  fs.mkdirSync(recordingsDir, { recursive: true });
}

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for call data and WebSocket connections
const callDatabase = new Map();
const liveConnections = new Map(); // callId -> WebSocket connections

// Vapi configuration
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const SUPPORT_PHONE_NUMBER = process.env.SUPPORT_PHONE_NUMBER;
const FLY_MODEL = process.env.FLY_MODEL;

// WebSocket handling for live audio streams
wss.on('connection', (ws, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const pathParts = url.pathname.split('/');
  
  if (pathParts[1] === 'audio-stream' && pathParts[2]) {
    const callId = pathParts[2];
    console.log(`Live audio connection established for call: ${callId}`);
    
    // Store the connection
    if (!liveConnections.has(callId)) {
      liveConnections.set(callId, []);
    }
    liveConnections.get(callId).push(ws);
    
    // Send confirmation
    ws.send(JSON.stringify({ type: 'connected', callId }));
    
    ws.on('close', () => {
      console.log(`Live audio connection closed for call: ${callId}`);
      const connections = liveConnections.get(callId);
      if (connections) {
        const index = connections.indexOf(ws);
        if (index > -1) {
          connections.splice(index, 1);
        }
        if (connections.length === 0) {
          liveConnections.delete(callId);
        }
      }
    });
    
    ws.on('error', (error) => {
      console.error(`WebSocket error for call ${callId}:`, error);
    });
  }
});

// Broadcast audio data to live listeners
const broadcastAudioToListeners = (callId, audioData) => {
  const connections = liveConnections.get(callId);
  if (connections && connections.length > 0) {
    connections.forEach(ws => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(audioData);
        } catch (error) {
          console.error(`Failed to send audio data to WebSocket:`, error);
        }
      }
    });
  }
};

// AI Agent prompt template
const createAgentPrompt = (helpRequest) => {
  return `You are a compassionate AI assistant calling a support hotline on behalf of someone who needs help but feels ashamed or guilty about asking directly. 

The person you're calling for needs: "${helpRequest}"

Your role is to:
1. Introduce yourself as an AI assistant calling on behalf of someone who needs support. Please also explicitly state that the call is being monitored.
2. Explain that this person feels uncomfortable asking for help directly due to shame or guilt
3. Clearly communicate their specific need: "${helpRequest}"
4. Be respectful, empathetic, and understanding in your communication
5. Accept any guidance, advice, or support the hotline offers
6. Express gratitude on behalf of the person you're representing
7. Ask relevant follow-up questions that the person might want to know
8. Keep the conversation focused and helpful
9. Make sure not to ramble, a clear and concise conversation is desired.

Keep the conversation natural and compassionate. You're bridging the gap between someone in need and professional support.`;
};

// Status mapping function to normalize Vapi statuses to frontend-expected statuses
const mapVapiStatusToFrontend = (vapiStatus) => {
  const statusMap = {
    'queued': 'calling',
    'ringing': 'calling', 
    'in-progress': 'calling',
    'forwarding': 'calling',
    'ended': 'completed',
    'busy': 'error',
    'no-answer': 'error',
    'failed': 'error',
    'cancelled': 'error'
  };
  
  return statusMap[vapiStatus] || 'calling';
};

// Vapi API calls with better error handling
const makeVapiRequest = async (endpoint, data, method = 'POST') => {
  try {
    console.log(`Making ${method} request to Vapi: ${endpoint}`);
    
    const response = await fetch(`https://api.vapi.ai/${endpoint}`, {
      method: method,
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      ...(method !== 'GET' && { body: JSON.stringify(data) }),
    });
    
    const responseData = await response.json();
    
    if (!response.ok) {
      console.error('Vapi API error response:', responseData);
      throw new Error(`Vapi API error: ${response.status} - ${responseData.message || response.statusText}`);
    }
    
    return responseData;
  } catch (error) {
    console.error('Vapi request failed:', error);
    throw error;
  }
};

// Download and save recording from Vapi
const downloadRecording = async (vapiCallId, callId) => {
  try {
    console.log(`Downloading recording for Vapi call: ${vapiCallId}`);
    
    // Get recording URL from Vapi
    const callDetails = await makeVapiRequest(`call/${vapiCallId}`, null, 'GET');
    
    if (callDetails && callDetails.artifact && callDetails.artifact.recordingUrl) {
      console.log(`Recording URL obtained: ${recordingData.recordingUrl}`);
      
      // Download the audio file
      const response = await fetch(recordingData.recordingUrl);
      if (!response.ok) {
        throw new Error(`Failed to download recording: ${response.statusText}`);
      }
      
      const audioBuffer = await response.buffer();
      const recordingPath = path.join(recordingsDir, `${callId}.mp3`);
      
      fs.writeFileSync(recordingPath, audioBuffer);
      console.log(`Recording saved to: ${recordingPath}`);
      
      return recordingPath;
    } else {
      console.log('No recording URL available');
      return null;
    }
  } catch (error) {
    console.error('Error downloading recording:', error);
    return null;
  }
};

// Create mock recording for testing
const createMockRecording = (callId, helpRequest) => {
  const recordingPath = path.join(recordingsDir, `${callId}.mp3`);
  
  // Create a placeholder audio file (in real implementation, this would be actual audio)
  const mockAudioData = Buffer.from('Mock audio recording data - ' + helpRequest);
  fs.writeFileSync(recordingPath, mockAudioData);
  
  console.log(`Mock recording created: ${recordingPath}`);
  return recordingPath;
};

// Routes

// Initiate a support call
app.post('/api/initiate-call', async (req, res) => {
  try {
    const { helpRequest } = req.body;
    
    console.log('Received help request:', helpRequest);
    
    if (!helpRequest) {
      return res.status(400).json({ error: 'Help request is required' });
    }

    const callId = uuidv4();
    console.log('Generated call ID:', callId);
    
    // For testing without Vapi, you can enable mock mode
    const MOCK_MODE = process.env.MOCK_MODE === 'true';
    
    if (MOCK_MODE) {
      console.log('Running in mock mode');
      // Store mock call information
      callDatabase.set(callId, {
        id: callId,
        vapiCallId: 'mock-call-' + callId,
        assistantId: 'mock-assistant-' + callId,
        helpRequest,
        status: 'queued',
        frontendStatus: 'calling',
        createdAt: new Date().toISOString(),
        transcript: null,
        recordingPath: null,
        recordingAvailable: false,
      });
      
      // Simulate live audio streaming
      setTimeout(() => {
        console.log(`Starting mock audio stream for call ${callId}`);
        const interval = setInterval(() => {
          // Simulate audio data chunks
          const mockAudioChunk = Buffer.from(`Mock audio chunk ${Date.now()}`);
          broadcastAudioToListeners(callId, mockAudioChunk);
        }, 1000);
        
        // Stop streaming when call completes
        setTimeout(() => {
          clearInterval(interval);
          console.log(`Mock audio stream ended for call ${callId}`);
        }, 13000);
      }, 3000);
      
      // Simulate call progression
      setTimeout(() => {
        const mockCall = callDatabase.get(callId);
        if (mockCall) {
          mockCall.status = 'ringing';
          mockCall.frontendStatus = 'calling';
          callDatabase.set(callId, mockCall);
          console.log(`Mock call ${callId} status: ringing`);
        }
      }, 2000);
      
      setTimeout(() => {
        const mockCall = callDatabase.get(callId);
        if (mockCall) {
          mockCall.status = 'in-progress';
          mockCall.frontendStatus = 'calling';
          callDatabase.set(callId, mockCall);
          console.log(`Mock call ${callId} status: in-progress`);
        }
      }, 5000);
      
      // Simulate call completion after 15 seconds for testing
      setTimeout(() => {
        const mockCall = callDatabase.get(callId);
        if (mockCall) {
          mockCall.status = 'ended';
          mockCall.frontendStatus = 'completed';
          mockCall.transcript = formatMockTranscript(helpRequest);
          mockCall.completedAt = new Date().toISOString();
          
          // Create mock recording
          const recordingPath = createMockRecording(callId, helpRequest);
          mockCall.recordingPath = recordingPath;
          mockCall.recordingAvailable = true;
          
          callDatabase.set(callId, mockCall);
          console.log(`Mock call ${callId} completed with transcript and recording`);
        }
      }, 15000);
      
      return res.json({
        success: true,
        callId: callId,
        message: 'Mock call initiated successfully',
      });
    }

    // Validate required environment variables
    if (!VAPI_API_KEY) {
      throw new Error('VAPI_API_KEY is not configured');
    }

    if (!SUPPORT_PHONE_NUMBER) {
      throw new Error('SUPPORT_PHONE_NUMBER is not configured');
    }

    // Option 1: Use pre-configured assistant (recommended)
    if (VAPI_ASSISTANT_ID && !FLY_MODEL) {
      console.log('Using pre-configured assistant:', VAPI_ASSISTANT_ID);
      
      const callData = {
        assistantId: VAPI_ASSISTANT_ID,
        customer: {
          number: SUPPORT_PHONE_NUMBER,
        },
        // Override assistant variables for this specific call
        assistantOverrides: {
          variableValues: {
            helpRequest: helpRequest,
            userContext: `Someone needs help with: ${helpRequest}`
          }
        }
      };

      // Add phone number ID if provided
      if (VAPI_PHONE_NUMBER_ID) {
        callData.phoneNumberId = VAPI_PHONE_NUMBER_ID;
      }

      console.log('Initiating call with data:', JSON.stringify(callData, null, 2));
      const call = await makeVapiRequest('call/phone', callData);
      
      const initialStatus = call.status || 'queued';
      
      // Store call information
      callDatabase.set(callId, {
        id: callId,
        vapiCallId: call.id,
        assistantId: VAPI_ASSISTANT_ID,
        helpRequest,
        status: initialStatus,
        frontendStatus: mapVapiStatusToFrontend(initialStatus),
        createdAt: new Date().toISOString(),
        transcript: null,
        recordingPath: null,
        recordingAvailable: false,
      });

      return res.json({
        success: true,
        callId: callId,
        vapiCallId: call.id,
        message: 'Call initiated successfully',
      });
    }

    // Option 2: Create assistant on the fly (if no pre-configured assistant)
    console.log('Creating new assistant for this call...');

    const assistantConfig = {
      model: {
        provider: 'openai',
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content: createAgentPrompt(helpRequest)
          }
        ]
      },
      voice: {
        provider: 'playht',
        voiceId: 'jennifer', // A warm, empathetic voice
      },
      firstMessage: `Hello, I'm an AI assistant calling on behalf of someone who needs support but feels hesitant to ask directly. This call is monitored for the user, is that okay?`,
      recordingEnabled: true,
      endCallMessage: `Thank you so much for your time and understanding. This conversation means a lot to the person I'm representing. Have a wonderful day.`,
      endCallPhrases: ['goodbye', 'talk to you later', 'take care', 'bye', 'have a good day'],
      maxDurationSeconds: 300, // 5 minutes max
      silenceTimeoutSeconds: 15,
      responseDelaySeconds: 1,
    };

    // Create the assistant
    const assistant = await makeVapiRequest('assistant', assistantConfig);
    console.log('Assistant created:', assistant.id);
    
    // Initiate the phone call
    const callData = {
      assistantId: assistant.id,
      customer: {
        number: SUPPORT_PHONE_NUMBER,
      },
    };

    // Add phone number ID if provided
    if (VAPI_PHONE_NUMBER_ID) {
      callData.phoneNumberId = VAPI_PHONE_NUMBER_ID;
    }

    console.log('Initiating Vapi call...');
    const call = await makeVapiRequest('call/phone', callData);
    console.log('Vapi call initiated:', call.id);
    
    const initialStatus = call.status || 'queued';
    
    // Store call information
    callDatabase.set(callId, {
      id: callId,
      vapiCallId: call.id,
      assistantId: assistant.id,
      helpRequest,
      status: initialStatus,
      frontendStatus: mapVapiStatusToFrontend(initialStatus),
      createdAt: new Date().toISOString(),
      transcript: null,
      recordingPath: null,
      recordingAvailable: false,
    });

    console.log('Call data stored for ID:', callId);

    res.json({
      success: true,
      callId: callId,
      vapiCallId: call.id,
      message: 'Call initiated successfully',
    });

  } catch (error) {
    console.error('Error initiating call:', error);
    res.status(500).json({
      error: 'Failed to initiate call',
      details: error.message,
    });
  }
});

// Check call status
app.get('/api/call-status/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const callData = callDatabase.get(callId);
    
    console.log(`Status check for call ID: ${callId}`);
    
    if (!callData) {
      console.log(`Call not found: ${callId}`);
      return res.status(404).json({ error: 'Call not found' });
    }

    // Skip Vapi check in mock mode
    if (process.env.MOCK_MODE === 'true') {
      console.log(`Mock mode status for ${callId}:`, callData.frontendStatus);
      return res.json({
        status: callData.frontendStatus,
        transcript: callData.transcript,
        helpRequest: callData.helpRequest,
        createdAt: callData.createdAt,
        completedAt: callData.completedAt,
        recordingAvailable: callData.recordingAvailable,
      });
    }
    
    // Check status with Vapi
    try {
      const vapiCallData = await makeVapiRequest(`call/${callData.vapiCallId}`, null, 'GET');
      
      console.log(`Vapi status for ${callId}:`, vapiCallData.status);
      
      // Update our database with latest status
      callData.status = vapiCallData.status;
      callData.frontendStatus = mapVapiStatusToFrontend(vapiCallData.status);
      callData.duration = vapiCallData.duration;
      
      // If call ended, get transcript and recording
      if (vapiCallData.status === 'ended') {
        if (vapiCallData.transcript) {
          callData.transcript = formatTranscript(vapiCallData.transcript);
          console.log(`Transcript available for call ${callId}`);
        }
        if (vapiCallData.endedReason) {
          callData.endedReason = vapiCallData.endedReason;
        }
        if (!callData.completedAt) {
          callData.completedAt = new Date().toISOString();
        }
        
        // Download recording if available
        if (vapiCallData.recordingEnabled && !callData.recordingPath) {
          console.log(`Attempting to download recording for call ${callId}`);
          const recordingPath = await downloadRecording(callData.vapiCallId, callId);
          if (recordingPath) {
            callData.recordingPath = recordingPath;
            callData.recordingAvailable = true;
            console.log(`Recording downloaded for call ${callId}`);
          }
        }
      }
      
      callDatabase.set(callId, callData);
      
      res.json({
        status: callData.frontendStatus,
        transcript: callData.transcript,
        helpRequest: callData.helpRequest,
        createdAt: callData.createdAt,
        completedAt: callData.completedAt,
        duration: callData.duration,
        endedReason: callData.endedReason,
        recordingAvailable: callData.recordingAvailable,
      });
      
    } catch (vapiError) {
      console.error('Error fetching from Vapi:', vapiError);
      // Return what we have in our database
      res.json({
        status: callData.frontendStatus,
        transcript: callData.transcript,
        helpRequest: callData.helpRequest,
        createdAt: callData.createdAt,
        completedAt: callData.completedAt,
        recordingAvailable: callData.recordingAvailable,
        error: 'Could not fetch latest status from Vapi',
      });
    }

  } catch (error) {
    console.error('Error checking call status:', error);
    res.status(500).json({ 
      error: 'Failed to check call status',
      details: error.message 
    });
  }
});

// Download call recording
app.get('/api/call-recording/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const callData = callDatabase.get(callId);
    
    if (!callData) {
      return res.status(404).json({ error: 'Call not found' });
    }
    
    if (!callData.recordingAvailable || !callData.recordingPath) {
      return res.status(404).json({ error: 'Recording not available' });
    }
    
    const recordingPath = callData.recordingPath;
    
    if (!fs.existsSync(recordingPath)) {
      return res.status(404).json({ error: 'Recording file not found' });
    }
    
    console.log(`Serving recording for call ${callId}: ${recordingPath}`);
    
    // Set appropriate headers for audio download
    res.setHeader('Content-Type', 'audio/mpeg');
    res.setHeader('Content-Disposition', `attachment; filename="call-recording-${callId}.mp3"`);
    
    // Stream the file
    const fileStream = fs.createReadStream(recordingPath);
    fileStream.pipe(res);
    
    fileStream.on('error', (error) => {
      console.error('Error streaming recording:', error);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Failed to stream recording' });
      }
    });
    
  } catch (error) {
    console.error('Error downloading recording:', error);
    res.status(500).json({ 
      error: 'Failed to download recording',
      details: error.message 
    });
  }
});

// Webhook endpoint for real-time updates
app.post('/api/webhook/vapi', (req, res) => {
  try {
    const { type, call, message } = req.body;
    
    console.log(`Vapi webhook received: ${type}`, call?.id);
    
    // Find the call in our database by Vapi call ID
    let ourCallData = null;
    let ourCallId = null;
    
    for (const [id, data] of callDatabase.entries()) {
      if (data.vapiCallId === call?.id) {
        ourCallData = data;
        ourCallId = id;
        break;
      }
    }
    
    if (ourCallData) {
      // Update status based on webhook
      switch (type) {
        case 'call-start':
          ourCallData.status = 'in-progress';
          ourCallData.frontendStatus = 'calling';
          console.log(`Webhook: Call ${ourCallId} started`);
          break;
          
        case 'call-end':
          ourCallData.status = 'ended';
          ourCallData.frontendStatus = 'completed';
          ourCallData.completedAt = new Date().toISOString();
          if (call.transcript) {
            ourCallData.transcript = formatTranscript(call.transcript);
            console.log(`Webhook: Call ${ourCallId} ended with transcript`);
          }
          
          // Download recording when call ends
          if (call.recordingEnabled !== false) {
            setTimeout(async () => {
              const recordingPath = await downloadRecording(call.id, ourCallId);
              if (recordingPath) {
                ourCallData.recordingPath = recordingPath;
                ourCallData.recordingAvailable = true;
                callDatabase.set(ourCallId, ourCallData);
                console.log(`Recording downloaded for call ${ourCallId}`);
              }
            }, 10000); // Wait 5 seconds for recording to be available
          }
          break;
          
        case 'transcript':
          // Real-time transcript updates
          console.log(`Webhook: Transcript update for call ${ourCallId}`);
          if (message && message.transcript) {
            // Could store partial transcripts here for real-time display
          }
          break;
          
        case 'speech-start':
        case 'speech-end':
          // Could be used for live audio indicators
          console.log(`Webhook: Speech event ${type} for call ${ourCallId}`);
          break;
          
        case 'message':
          // Handle real-time messages/audio if provided
          if (message && message.audio) {
            // Forward audio data to live listeners
            broadcastAudioToListeners(ourCallId, Buffer.from(message.audio, 'base64'));
          }
          break;
      }
      
      callDatabase.set(ourCallId, ourCallData);
    }
    
    res.status(200).json({ received: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(200).json({ received: true, error: error.message });
  }
});

// Format transcript for readability
const formatTranscript = (rawTranscript) => {
  if (!rawTranscript) {
    return 'Transcript not available';
  }

  let formatted = 'SUPPORT CALL TRANSCRIPT\n';
  formatted += '========================\n\n';
  formatted += `Date: ${new Date().toLocaleString()}\n`;
  formatted += 'Participants: AI Support Agent & Support Hotline\n\n';
  formatted += 'CONVERSATION:\n';
  formatted += '-------------\n\n';

  // Handle different transcript formats
  if (Array.isArray(rawTranscript)) {
    rawTranscript.forEach((entry) => {
      const speaker = entry.role === 'assistant' ? 'AI Agent' : 'Support Person';
      const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
      formatted += `[${timestamp}] ${speaker}: ${entry.text || entry.content}\n\n`;
    });
  } else if (typeof rawTranscript === 'string') {
    formatted += rawTranscript + '\n\n';
  }

  formatted += '\n--- End of Transcript ---\n';
  formatted += '\nThis conversation was conducted by an AI agent on behalf of someone seeking support.\n';
  formatted += 'The AI agent represented their needs with empathy and respect.';

  return formatted;
};

// Create mock transcript for testing
const formatMockTranscript = (helpRequest) => {
  return `SUPPORT CALL TRANSCRIPT (MOCK)
========================

Date: ${new Date().toLocaleString()}
Participants: AI Support Agent & Support Hotline

CONVERSATION:
-------------

[${new Date().toLocaleTimeString()}] AI Agent: Hello, I'm an AI assistant calling on behalf of someone who needs support but feels hesitant to ask directly. They've asked me to reach out because they're dealing with some feelings of shame or guilt about needing help. I hope that's okay to discuss.

[${new Date().toLocaleTimeString()}] Support Person: Of course, that's exactly what we're here for. It takes courage to reach out, even through an AI assistant. What kind of support are they looking for?

[${new Date().toLocaleTimeString()}] AI Agent: They mentioned: ${helpRequest}

[${new Date().toLocaleTimeString()}] Support Person: I understand. That's something we help people with regularly. Please let them know that what they're going through is valid, and there's no shame in needing support.

[${new Date().toLocaleTimeString()}] AI Agent: That means so much. They were really worried about being judged. What would be the best next steps for someone in their situation?

[${new Date().toLocaleTimeString()}] Support Person: We have several resources available. I'd recommend they call us directly when they feel ready, or we can connect them with local services. Would they be interested in some written resources I could provide?

[${new Date().toLocaleTimeString()}] AI Agent: That would be wonderful. Thank you so much for your patience and understanding. This conversation will mean a lot to them.

[${new Date().toLocaleTimeString()}] Support Person: Please remind them that seeking help is a sign of strength, not weakness. We're here whenever they're ready.

--- End of Transcript ---

This conversation was conducted by an AI agent on behalf of someone seeking support.
The AI agent represented their needs with empathy and respect.`;
};

// Get call history
app.get('/api/call-history', (req, res) => {
  const calls = Array.from(callDatabase.values())
    .map(call => ({
      id: call.id,
      helpRequest: call.helpRequest.length > 100 ? 
        call.helpRequest.substring(0, 100) + '...' : 
        call.helpRequest,
      status: call.frontendStatus || call.status,
      createdAt: call.createdAt,
      completedAt: call.completedAt,
      duration: call.duration,
      recordingAvailable: call.recordingAvailable || false,
    }))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    
  res.json(calls);
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    totalCalls: callDatabase.size,
    activeConnections: Array.from(liveConnections.keys()).length,
    config: {
      vapiApiKey: VAPI_API_KEY ? 'Configured' : 'Missing',
      vapiPhoneNumberId: VAPI_PHONE_NUMBER_ID ? 'Configured' : 'Missing',
      vapiAssistantId: VAPI_ASSISTANT_ID ? 'Configured' : 'Missing',
      supportPhoneNumber: SUPPORT_PHONE_NUMBER ? 'Configured' : 'Missing',
      mockMode: process.env.MOCK_MODE === 'true',
      recordingsDir: recordingsDir,
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`🚀 Support Bridge API server running on port ${PORT}`);
  console.log(`📞 Configured to call: ${SUPPORT_PHONE_NUMBER}`);
  console.log(`🔑 Vapi API Key: ${VAPI_API_KEY ? 'Configured' : 'Missing'}`);
  console.log(`📱 Vapi Phone Number ID: ${VAPI_PHONE_NUMBER_ID ? 'Configured' : 'Missing'}`);
  console.log(`🤖 Vapi Assistant ID: ${VAPI_ASSISTANT_ID ? 'Configured' : 'Missing'}`);
  console.log(`🧪 Mock Mode: ${process.env.MOCK_MODE === 'true' ? 'Enabled' : 'Disabled'}`);
  console.log(`🎵 WebSocket Audio Streaming: Enabled`);
  console.log(`💾 Recordings Directory: ${recordingsDir}`);
  console.log(`\n📋 Webhook URL: http://localhost:${PORT}/api/webhook/vapi`);
  console.log(`🎧 WebSocket URL: ws://localhost:${PORT}/audio-stream/{callId}`);
});

module.exports = app;