const express = require('express');
const cors = require('cors');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

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
    
    if (!helpRequest) {
      return res.status(400).json({ error: 'Help request is required' });
    }

    const callId = uuidv4();
    
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
      firstMessage: 'Hi, I am an AI assistant calling on behalf of someone who needs some support but feels hesitant to ask directly. They have asked me to reach out because they are dealing with some feelings of shame or guilt about needing help. I hope that is okay.',
      recordingEnabled: true,
      endCallMessage: 'Thank you so much for your time and understanding. This conversation means a lot to the person I am representing.',
      endCallPhrases: ['goodbye', 'talk to you later', 'take care', 'bye'],
      maxDurationSeconds: 1800, // 30 minutes max
    };

    // Create the assistant
    const assistant = await makeVapiRequest('assistant', assistantConfig);
    
    // Initiate the phone call
    const callData = {
      assistantId: assistant.id,
      phoneNumberId: SUPPORT_PHONE_NUMBER,
      customer: {
        number: SUPPORT_PHONE_NUMBER,
      },
    };

    const call = await makeVapiRequest('call/phone', callData);
    
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