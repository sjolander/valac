import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { StorageService } from './services/StorageService.js';
import { ask } from './ask.js';
import Storage from './services/StorageInstance.js';
import memoryRoutes from './routes/memory.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize storage
const storageService: StorageService = Storage;

const PORT = process.env.PORT || 3000;

console.log(`Using Ollama at ${process.env.OLLAMA_HOST}`);

app.post('/ask', async (req, res) => {
  console.log('Received ask request');
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }
  const response = await ask(prompt, storageService);
  res.json({ response });
});

app.use('/memory', memoryRoutes);

app.listen(PORT, () => {
  console.log(`Valac backend listening on port ${PORT}`);
});
