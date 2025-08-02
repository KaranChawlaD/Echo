const fetch = require('node-fetch');
const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
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
const SUPPORT_PHONE_NUMBER = process.env.SUPPORT_PHONE_NUMBER; // Your friend's number

// AI Agent prompt template
const createAgentPrompt = (helpRequest) => {
  return `You are a compassionate AI assistant calling on behalf of someone who needs help but feels ashamed or guilty about asking directly. 

The person you're calling for needs: "${helpRequest}"

Your role is to:
1. Introduce yourself as an AI assistant calling on behalf of someone who needs support
2. Explain that this person feels uncomfortable asking for help directly due to shame or guilt
3. Clearly communicate their specific need: "${helpRequest}"
4. Be respectful, empathetic, and understanding in your communication
5. Accept any guidance, advice, or support the person offers
6. Express gratitude on behalf of the person you're representing

Keep the conversation natural and compassionate. You're bridging the gap between someone in need and someone who can help.`;
};

// Vapi API calls
const makeVapiRequest = async (endpoint, data) => {
  const response = await fetch(`https://api.vapi.ai/${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VAPI_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(data),
  });
  
  if (!response.ok) {
    throw new Error(`Vapi API error: ${response.statusText}`);
  }
  
  return response.json();
};

// Routes

// Initiate a support call
app.post('/api/initiate-call', async (req, res) => {
  try {
    const { helpRequest } = req.body;
    
    console.log('Received help request:', helpRequest); // Debug log
    
    if (!helpRequest) {
      return res.status(400).json({ error: 'Help request is required' });
    }

    const callId = uuidv4();
    console.log('Generated call ID:', callId); // Debug log
    
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
        status: 'in_progress',
        createdAt: new Date().toISOString(),
        transcript: null,
      });
      
      // Simulate call completion after 10 seconds
      setTimeout(() => {
        const mockCall = callDatabase.get(callId);
        if (mockCall) {
          mockCall.status = 'completed';
          mockCall.transcript = `MOCK TRANSCRIPT\n\nAI Agent: Hello, I'm calling on behalf of someone who needs help with: ${helpRequest}\n\nSupport Person: Of course, I'd be happy to help. What specifically do they need?\n\nAI Agent: They mentioned: ${helpRequest}\n\nSupport Person: I understand. Please let them know I'm here to support them.\n\nAI Agent: Thank you so much for your understanding and support.`;
          mockCall.completedAt = new Date().toISOString();
          callDatabase.set(callId, mockCall);
        }
      }, 10000);
      
      return res.json({
        success: true,
        callId: callId,
        message: 'Mock call initiated successfully',
      });
    }

    // Real Vapi implementation
    if (!VAPI_API_KEY) {
      throw new Error('VAPI_API_KEY is not configured');
    }

    if (!SUPPORT_PHONE_NUMBER) {
      throw new Error('SUPPORT_PHONE_NUMBER is not configured');
    }

    // Create Vapi assistant configuration
    const assistantConfig = {
      model: {
        provider: 'openai',
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: createAgentPrompt(helpRequest)
          }
        ]
      },
      voice: {
        provider: 'elevenlabs',
        voiceId: 'pNInz6obpgDQGcFmaJgB', // A warm, empathetic voice
      },
      firstMessage: `Hi, I'm an AI assistant calling on behalf of someone who needs some support but feels hesitant to ask directly. They've asked me to reach out because they're dealing with some feelings of shame or guilt about needing help. I hope that's okay.`,
      recordingEnabled: true,
      endCallMessage: `Thank you so much for your time and understanding. This conversation means a lot to the person I'm representing.`,
      endCallPhrases: ['goodbye', 'talk to you later', 'take care', 'bye'],
      maxDurationSeconds: 1800, // 30 minutes max
    };

    console.log('Creating Vapi assistant...'); // Debug log

    // Create the assistant
    const assistant = await makeVapiRequest('assistant', assistantConfig);
    console.log('Assistant created:', assistant.id); // Debug log
    
    // Initiate the phone call
    const callData = {
      assistantId: assistant.id,
      phoneNumberId: SUPPORT_PHONE_NUMBER,
      customer: {
        number: SUPPORT_PHONE_NUMBER,
      },
    };

    console.log('Initiating Vapi call...'); // Debug log
    const call = await makeVapiRequest('call/phone', callData);
    console.log('Vapi call initiated:', call.id); // Debug log
    
    // Store call information
    callDatabase.set(callId, {
      id: callId,
      vapiCallId: call.id,
      assistantId: assistant.id,
      helpRequest,
      status: 'in_progress',
      createdAt: new Date().toISOString(),
      transcript: null,
    });

    console.log('Call data stored for ID:', callId); // Debug log

    res.json({
      success: true,
      callId: callId,
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
    
    if (!callData) {
      return res.status(404).json({ error: 'Call not found' });
    }

    // Skip Vapi check in mock mode
    if (process.env.MOCK_MODE === 'true') {
      return res.json({
        status: callData.status === 'completed' ? 'completed' : 'in_progress',
        transcript: callData.transcript,
      });
    }
    
    // Check status with Vapi
    const vapiResponse = await fetch(`https://api.vapi.ai/call/${callData.vapiCallId}`, {
      headers: {
        'Authorization': `Bearer ${VAPI_API_KEY}`,
      },
    });

    if (vapiResponse.ok) {
      const vapiCallData = await vapiResponse.json();
      
      // Update our database
      callData.status = vapiCallData.status;
      
      if (vapiCallData.status === 'ended' && vapiCallData.transcript) {
        callData.transcript = formatTranscript(vapiCallData.transcript);
        callData.completedAt = new Date().toISOString();
      }
      
      callDatabase.set(callId, callData);
      
      res.json({
        status: vapiCallData.status === 'ended' ? 'completed' : vapiCallData.status,
        transcript: callData.transcript,
      });
    } else {
      res.status(500).json({ error: 'Failed to check call status' });
    }

  } catch (error) {
    console.error('Error checking call status:', error);
    res.status(500).json({ error: 'Failed to check call status' });
  }
});

// Format transcript for readability
const formatTranscript = (rawTranscript) => {
  if (!rawTranscript || !Array.isArray(rawTranscript)) {
    return 'Transcript not available';
  }

  let formatted = 'SUPPORT CALL TRANSCRIPT\n';
  formatted += '========================\n\n';
  formatted += `Date: ${new Date().toLocaleString()}\n`;
  formatted += 'Participants: AI Support Agent & Support Person\n\n';
  formatted += 'CONVERSATION:\n';
  formatted += '-------------\n\n';

  rawTranscript.forEach((entry, index) => {
    const speaker = entry.role === 'assistant' ? 'AI Agent' : 'Support Person';
    const timestamp = entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '';
    formatted += `[${timestamp}] ${speaker}: ${entry.text}\n\n`;
  });

  formatted += '\n--- End of Transcript ---\n';
  formatted += '\nThis conversation was conducted by an AI agent on behalf of someone seeking support.\n';
  formatted += 'The AI agent represented their needs with empathy and respect.';

  return formatted;
};

// Get call history (optional feature)
app.get('/api/call-history', (req, res) => {
  const calls = Array.from(callDatabase.values())
    .map(call => ({
      id: call.id,
      helpRequest: call.helpRequest.substring(0, 100) + '...',
      status: call.status,
      createdAt: call.createdAt,
      completedAt: call.completedAt,
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
app.listen(PORT, () => {
  console.log(`🚀 Support Bridge API server running on port ${PORT}`);
  console.log(`📞 Configured for calls to: ${SUPPORT_PHONE_NUMBER}`);
  console.log(`🔑 Vapi API Key: ${VAPI_API_KEY ? 'Configured' : 'Missing'}`);
});

module.exports = app;