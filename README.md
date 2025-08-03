# Echo

Echo is a web-based tool that allows users to make phone calls through an AI agent that speaks on their behalf. Designed for those who may feel anxious, ashamed, or uncomfortable speaking out loud, Echo lets users request help with a single prompt.

## Features

- AI agent initiates and holds phone calls based on user prompts
- Supports calling hotlines, therapists, professionals, or personal contacts
- Transcription and AI-recreated audio of the conversation (.wav file)
- Optional call recording with recipient's permission

## Tech Stack

### Frontend
- Next.js
- JavaScript
- Tailwind CSS

### Backend
- Express.js
- WebSocket (`ws` library)

### AI & Audio
- OpenAI GPT-4o-mini
- VAPI for voice interaction
- Gemini 2.5 Flash Preview TTS for audio recreation

### Telephony
- Twilio

## Setup Instructions

### 1. Clone the repository
```bash
git clone https://github.com/yourusername/echo.git
cd echo
```

### 2. Install dependencies
```bash
npm install
# or
yarn install
```

### 3. Create environment variables

```bash
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=
VAPI_API_KEY=
OPENAI_API_KEY=
GEMINI_API_KEY=
```

### 4. Run the application
In one terminal

```bash
cd backend
node server.js
```

In another terminal

```bash
cd frontend
npm run dev
```