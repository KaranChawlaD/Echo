const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
const { WebSocketServer } = require('ws');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3002;

// Middleware
app.use(cors());
app.use(express.json());

// In-memory storage for call data (use a database in production)
const callDatabase = new Map();

// Vapi configuration
const VAPI_API_KEY = process.env.VAPI_API_KEY;
const VAPI_PHONE_NUMBER_ID = process.env.VAPI_PHONE_NUMBER_ID;
const VAPI_ASSISTANT_ID = process.env.VAPI_ASSISTANT_ID;
const SUPPORT_PHONE_NUMBER = process.env.SUPPORT_PHONE_NUMBER;
const FLY_MODEL = process.env.FLY_MODEL;
const VAPI_BASE_URL = "https://api.vapi.ai";
const POLL_INTERVAL_MS = 3000;

// WebSocket clients tracking
const clients = new Set();

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

// WebSocket broadcasting function
function broadcastEvent(event) {
  const data = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === 1) { // WebSocket.OPEN
      try {
        ws.send(data);
      } catch (error) {
        console.error('Error sending WebSocket message:', error);
        clients.delete(ws);
      }
    }
  }
}

// Polling function for call status
async function pollCall(callId, vapiCallId) {
  try {
    const response = await fetch(`${VAPI_BASE_URL}/call/${vapiCallId}`, {
      headers: {
        Authorization: `Bearer ${VAPI_API_KEY}`,
      },
    });

    const callData = await response.json();
    
    if (!callData) {
      return;
    }
    
    console.log("Call data status:", callData.status);
    
    // Get our stored call data
    const ourCallData = callDatabase.get(callId);
    if (!ourCallData) return;
    
    // Update status and broadcast events
    const previousStatus = ourCallData.status;
    ourCallData.status = callData.status;
    ourCallData.frontendStatus = mapVapiStatusToFrontend(callData.status);
    
    // Broadcast status changes
    if (callData.status === 'ringing' && previousStatus !== 'ringing') {
      broadcastEvent({ type: "ringing", callId });
    } else if (callData.status === 'in-progress' && previousStatus !== 'in-progress') {
      broadcastEvent({ type: "in-progress", callId });
    }
    
    // Check for new messages and broadcast them
    if (callData.messages && Array.isArray(callData.messages)) {
      const previousMessageTimes = ourCallData.previousMessageTimes || new Set();
      const newMessages = callData.messages.filter(msg => 
        !previousMessageTimes.has(msg.time) && msg.role !== "system"
      );
      
      newMessages.forEach((msg) => {
        previousMessageTimes.add(msg.time);
        broadcastEvent({ 
          type: 'message', 
          text: msg.message,
          role: msg.role,
          callId 
        });
      });
      
      ourCallData.previousMessageTimes = previousMessageTimes;
    }
    
    // Handle call completion
    if (callData.status === 'ended' && !ourCallData.callEnded) {
      ourCallData.callEnded = true;
      ourCallData.completedAt = new Date().toISOString();
      
      broadcastEvent({ type: 'call_ended', callId });
      
      // Process transcript
      if (callData.messages) {
        const transcript = formatTranscriptFromMessages(callData.messages, ourCallData.helpRequest);
        ourCallData.transcript = transcript;
        
        broadcastEvent({ 
          type: 'transcript_ready', 
          transcript: transcript,
          callId 
        });
      }
      
      // Stop polling for this call
      if (ourCallData.pollingInterval) {
        clearInterval(ourCallData.pollingInterval);
      }
    }
    
    // Update database
    callDatabase.set(callId, ourCallData);
    
  } catch (err) {
    console.error("Polling error:", err);
    broadcastEvent({ type: 'call_error', error: err.message, callId });
  }
}

// Status mapping function
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

// Enhanced VAPI request function
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
    
    // Mock mode for testing
    const MOCK_MODE = process.env.MOCK_MODE === 'true';
    
    if (MOCK_MODE) {
      console.log('Running in mock mode');
      
      const mockCallData = {
        id: callId,
        vapiCallId: 'mock-call-' + callId,
        assistantId: 'mock-assistant-' + callId,
        helpRequest,
        status: 'queued',
        frontendStatus: 'calling',
        createdAt: new Date().toISOString(),
        transcript: null,
        callEnded: false,
        previousMessageTimes: new Set(),
      };
      
      callDatabase.set(callId, mockCallData);
      
      // Simulate call progression with broadcasting
      setTimeout(() => {
        const mockCall = callDatabase.get(callId);
        if (mockCall) {
          mockCall.status = 'ringing';
          broadcastEvent({ type: 'ringing', callId });
          callDatabase.set(callId, mockCall);
        }
      }, 2000);
      
      setTimeout(() => {
        const mockCall = callDatabase.get(callId);
        if (mockCall) {
          mockCall.status = 'in-progress';
          broadcastEvent({ type: 'in-progress', callId });
          callDatabase.set(callId, mockCall);
        }
      }, 5000);
      
      // Simulate messages
      setTimeout(() => {
        broadcastEvent({ 
          type: 'message', 
          text: 'AI Agent: Hello, I\'m calling on behalf of someone who needs support...',
          role: 'assistant',
          callId 
        });
      }, 7000);
      
      setTimeout(() => {
        broadcastEvent({ 
          type: 'message', 
          text: 'Support Person: Of course, we\'re here to help. What can we do?',
          role: 'user',
          callId 
        });
      }, 10000);
      
      // Simulate call completion
      setTimeout(() => {
        const mockCall = callDatabase.get(callId);
        if (mockCall && !mockCall.callEnded) {
          mockCall.status = 'ended';
          mockCall.frontendStatus = 'completed';
          mockCall.callEnded = true;
          mockCall.transcript = formatMockTranscript(helpRequest);
          mockCall.completedAt = new Date().toISOString();
          callDatabase.set(callId, mockCall);
          
          broadcastEvent({ type: 'call_ended', callId });
          broadcastEvent({ 
            type: 'transcript_ready', 
            transcript: mockCall.transcript,
            callId 
          });
        }
      }, 15000);
      
      return res.json({
        success: true,
        callId: callId,
        message: 'Mock call initiated successfully',
      });
    }

    // Real VAPI call logic
    if (!VAPI_API_KEY) {
      throw new Error('VAPI_API_KEY is not configured');
    }

    if (!SUPPORT_PHONE_NUMBER) {
      throw new Error('SUPPORT_PHONE_NUMBER is not configured');
    }

    let vapiCallId;
    let assistantId = VAPI_ASSISTANT_ID;

    // Create assistant if needed
    if (!assistantId) {
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
          voiceId: 'jennifer',
        },
        firstMessage: `Hello, I'm an AI assistant calling on behalf of someone who needs support but feels hesitant to ask directly. This call is monitored for the user, is that okay?`,
        recordingEnabled: true,
        endCallMessage: `Thank you so much for your time and understanding. This conversation means a lot to the person I'm representing. Have a wonderful day.`,
        endCallPhrases: ['goodbye', 'talk to you later', 'take care', 'bye', 'have a good day'],
        maxDurationSeconds: 300,
        silenceTimeoutSeconds: 15,
        responseDelaySeconds: 1,
      };

      const assistant = await makeVapiRequest('assistant', assistantConfig);
      assistantId = assistant.id;
    }
    
    // Initiate the call
    const callData = {
      assistantId: assistantId,
      customer: {
        number: SUPPORT_PHONE_NUMBER,
      },
    };

    if (VAPI_PHONE_NUMBER_ID) {
      callData.phoneNumberId = VAPI_PHONE_NUMBER_ID;
    }

    const call = await makeVapiRequest('call/phone', callData);
    vapiCallId = call.id;
    
    // Store call information
    const callInfo = {
      id: callId,
      vapiCallId: vapiCallId,
      assistantId: assistantId,
      helpRequest,
      status: call.status || 'queued',
      frontendStatus: mapVapiStatusToFrontend(call.status || 'queued'),
      createdAt: new Date().toISOString(),
      transcript: null,
      callEnded: false,
      previousMessageTimes: new Set(),
      listenUrl: call.monitor?.listenUrl || null,
    };
    
    callDatabase.set(callId, callInfo);
    
    // Start polling for this call
    const pollingInterval = setInterval(() => {
      pollCall(callId, vapiCallId);
    }, POLL_INTERVAL_MS);
    
    callInfo.pollingInterval = pollingInterval;
    callDatabase.set(callId, callInfo);

    res.json({
      success: true,
      callId: callId,
      vapiCallId: vapiCallId,
      listenUrl: callInfo.listenUrl,
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

// Check call status (enhanced with real-time data)
app.get('/api/call-status/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const callData = callDatabase.get(callId);
    
    if (!callData) {
      return res.status(404).json({ error: 'Call not found' });
    }

    res.json({
      status: callData.frontendStatus,
      transcript: callData.transcript,
      helpRequest: callData.helpRequest,
      createdAt: callData.createdAt,
      completedAt: callData.completedAt,
      listenUrl: callData.listenUrl,
      duration: callData.duration,
      endedReason: callData.endedReason,
    });

  } catch (error) {
    console.error('Error checking call status:', error);
    res.status(500).json({ 
      error: 'Failed to check call status',
      details: error.message 
    });
  }
});

// End call endpoint
app.post('/api/end-call/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    const callData = callDatabase.get(callId);
    
    if (!callData) {
      return res.status(404).json({ error: 'Call not found' });
    }

    if (process.env.MOCK_MODE === 'true') {
      // Handle mock call ending
      callData.status = 'ended';
      callData.frontendStatus = 'completed';
      callData.callEnded = true;
      callDatabase.set(callId, callData);
      broadcastEvent({ type: 'call_ended', callId });
      return res.json({ message: 'Mock call ended successfully' });
    }

    // End real VAPI call
    await fetch(`${VAPI_BASE_URL}/call/${callData.vapiCallId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        status: 'ended'
      })
    });

    broadcastEvent({ type: 'call_ended', callId });
    res.json({ message: 'Call ended successfully' });
    
  } catch (error) {
    console.error('Error ending call:', error);
    res.status(500).json({ error: 'Error ending call' });
  }
});

// Webhook endpoint for real-time updates
app.post('/api/webhook/vapi', (req, res) => {
  try {
    const { type, call } = req.body;
    
    console.log(`Vapi webhook received: ${type}`, call?.id);
    
    // Find our call and broadcast the event
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
      // Broadcast webhook events to connected clients
      broadcastEvent({ 
        type: `webhook_${type}`, 
        callId: ourCallId,
        data: call 
      });
      
      // Update status based on webhook
      switch (type) {
        case 'call-start':
          ourCallData.status = 'in-progress';
          ourCallData.frontendStatus = 'calling';
          broadcastEvent({ type: 'in-progress', callId: ourCallId });
          break;
        case 'call-end':
          ourCallData.status = 'ended';
          ourCallData.frontendStatus = 'completed';
          ourCallData.completedAt = new Date().toISOString();
          ourCallData.callEnded = true;
          if (call.transcript) {
            ourCallData.transcript = formatTranscript(call.transcript);
          }
          broadcastEvent({ type: 'call_ended', callId: ourCallId });
          broadcastEvent({ 
            type: 'transcript_ready', 
            transcript: ourCallData.transcript,
            callId: ourCallId 
          });
          break;
        case 'transcript':
          // Real-time transcript updates
          if (call.transcript) {
            broadcastEvent({ 
              type: 'live_transcript', 
              transcript: call.transcript,
              callId: ourCallId 
            });
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

// Format transcript from messages
const formatTranscriptFromMessages = (messages, helpRequest) => {
  let formatted = 'SUPPORT CALL TRANSCRIPT\n';
  formatted += '========================\n\n';
  formatted += `Date: ${new Date().toLocaleString()}\n`;
  formatted += 'Participants: AI Support Agent & Support Hotline\n';
  formatted += `Request: ${helpRequest}\n\n`;
  formatted += 'CONVERSATION:\n';
  formatted += '-------------\n\n';

  const filteredMessages = messages.filter(msg => msg.role !== "system");
  
  filteredMessages.forEach((entry) => {
    const speaker = entry.role === 'assistant' ? 'AI Agent' : 'Support Person';
    const timestamp = entry.time ? new Date(entry.time).toLocaleTimeString() : '';
    formatted += `[${timestamp}] ${speaker}: ${entry.message}\n\n`;
  });

  formatted += '\n--- End of Transcript ---\n';
  formatted += '\nThis conversation was conducted by an AI agent on behalf of someone seeking support.\n';
  formatted += 'The AI agent represented their needs with empathy and respect.';

  return formatted;
};

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
    activeClients: clients.size,
    config: {
      vapiApiKey: VAPI_API_KEY ? 'Configured' : 'Missing',
      vapiPhoneNumberId: VAPI_PHONE_NUMBER_ID ? 'Configured' : 'Missing',
      vapiAssistantId: VAPI_ASSISTANT_ID ? 'Configured' : 'Missing',
      supportPhoneNumber: SUPPORT_PHONE_NUMBER ? 'Configured' : 'Missing',
      mockMode: process.env.MOCK_MODE === 'true',
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

// Start HTTP server
const server = app.listen(PORT, () => {
  console.log(`🚀 Support Bridge API server running on port ${PORT}`);
  console.log(`📞 Configured to call: ${SUPPORT_PHONE_NUMBER}`);
  console.log(`🔑 Vapi API Key: ${VAPI_API_KEY ? 'Configured' : 'Missing'}`);
  console.log(`📱 Vapi Phone Number ID: ${VAPI_PHONE_NUMBER_ID ? 'Configured' : 'Missing'}`);
  console.log(`🤖 Vapi Assistant ID: ${VAPI_ASSISTANT_ID ? 'Configured' : 'Missing'}`);
  console.log(`🧪 Mock Mode: ${process.env.MOCK_MODE === 'true' ? 'Enabled' : 'Disabled'}`);
  console.log(`\n📋 Webhook URL: http://localhost:${PORT}/api/webhook/vapi`);
});

// WebSocket server setup
const wss = new WebSocketServer({ server, path: "/ws" });

wss.on("connection", (ws) => {
  console.log('New WebSocket client connected');
  clients.add(ws);
  
  // Send current call statuses to new client
  const activeCalls = Array.from(callDatabase.values())
    .filter(call => call.frontendStatus === 'calling')
    .map(call => ({
      type: 'call_status',
      callId: call.id,
      status: call.frontendStatus
    }));
  
  activeCalls.forEach(status => {
    try {
      ws.send(JSON.stringify(status));
    } catch (error) {
      console.error('Error sending initial status:', error);
    }
  });
  
  ws.on("close", () => {
    console.log('WebSocket client disconnected');
    clients.delete(ws);
  });
  
  ws.on("error", (error) => {
    console.error('WebSocket error:', error);
    clients.delete(ws);
  });
});

console.log(`🔌 WebSocket server running on ws://localhost:${PORT}/ws`);

module.exports = app;