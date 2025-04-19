const express = require('express');
const { urlencoded } = require('body-parser');
const { MessagingResponse } = require('twilio').twiml;
const { Configuration, OpenAIApi } = require('openai');
const { PredictionServiceClient } = require('@google-cloud/aiplatform').v1;
const path = require('path');
require('dotenv').config();

const app = express();
app.use(urlencoded({ extended: false }));

// Variáveis de ambiente
const PORT = process.env.PORT || 3000;
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const GOOGLE_APPLICATION_CREDENTIALS = process.env.GOOGLE_APPLICATION_CREDENTIALS;

// Verificação
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || !TWILIO_WHATSAPP_NUMBER || !OPENAI_API_KEY || !GOOGLE_APPLICATION_CREDENTIALS) {
  console.error('Erro: Variáveis de ambiente ausentes. Verifique seu arquivo .env');
  process.exit(1);
}

// Inicializa OpenAI
const openai = new OpenAIApi(new Configuration({
  apiKey: OPENAI_API_KEY,
}));

// Inicializa Gemini
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.resolve(GOOGLE_APPLICATION_CREDENTIALS);
const googleClient = new PredictionServiceClient();

// Armazenamento de conversas
const conversations = {};

// Escolha dinâmica da IA
function decideAI(message) {
  const msg = message.toLowerCase();
  if (msg.match(/\b(math|code|program|calculate|algorithm|script|function)\b/)) {
    return 'chatgpt';
  }
  if (msg.match(/\b(image|draw|picture|photo|paint|art|design)\b/)) {
    return 'gemini';
  }
  return 'chatgpt';
}

// Chamada ChatGPT
async function callChatGPT(conversation) {
  try {
    const response = await openai.createChatCompletion({
      model: 'gpt-4',
      messages: conversation,
      temperature: 0.7,
      max_tokens: 1000,
    });
    return response.data.choices[0].message.content.trim();
  } catch (error) {
    console.error('Erro ChatGPT:', error);
    return 'Erro ao processar com ChatGPT.';
  }
}

// Chamada Gemini
async function callGemini(prompt) {
  try {
    const project = 'your-google-cloud-project-id';
    const location = 'us-central1';
    const endpointId = 'your-gemini-endpoint-id';
    const endpoint = `projects/${project}/locations/${location}/endpoints/${endpointId}`;
    const request = {
      endpoint,
      instances: [ { content: prompt } ],
      parameters: { temperature: 0.7, maxOutputTokens: 1000 },
    };
    const [response] = await googleClient.predict(request);
    if (response.predictions && response.predictions.length > 0) {
      const prediction = response.predictions[0];
      return typeof prediction === 'string' ? prediction.trim() : prediction.content?.trim() || '';
    }
    return 'Não consegui gerar uma resposta com Gemini.';
  } catch (error) {
    console.error('Erro Gemini:', error);
    return 'Erro ao processar com Gemini.';
  }
}

// Webhook principal
app.post('/webhook', async (req, res) => {
  const twiml = new MessagingResponse();
  const from = req.body.From || '';
  const body = req.body.Body || '';

  if (!from.startsWith('whatsapp:')) {
    res.status(400).send('Fonte inválida');
    return;
  }

  const userPhone = from.replace('whatsapp:', '');

  if (!conversations[userPhone]) {
    conversations[userPhone] = { history: [], lastUsed: Date.now() };
  }

  conversations[userPhone].lastUsed = Date.now();
  conversations[userPhone].history.push({ role: 'user', content: body });

  const aiChoice = decideAI(body);
  let reply = '';

  if (aiChoice === 'chatgpt') {
    reply = await callChatGPT(conversations[userPhone].history);
  } else {
    reply = await callGemini(body);
  }

  conversations[userPhone].history.push({ role: 'assistant', content: reply });

  if (conversations[userPhone].history.length > 40) {
    conversations[userPhone].history.splice(0, conversations[userPhone].history.length - 40);
  }

  twiml.message(reply);
  res.writeHead(200, { 'Content-Type': 'text/xml' });
  res.end(twiml.toString());
});

// Limpeza de histórico
setInterval(() => {
  const now = Date.now();
  for (const user in conversations) {
    if (now - conversations[user].lastUsed > 3600000) {
      delete conversations[user];
    }
  }
}, 600000);

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`Servidor WhatsApp AI iniciado na porta ${PORT}`);
});
