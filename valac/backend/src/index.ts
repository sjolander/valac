import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import { StorageService } from './services/StorageService.js';
import { QdrantService } from './services/QdrantService.js';
import { ask } from './ask.js';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Initialize storage
const storageService: StorageService = new QdrantService();

const PORT = process.env.PORT || 3000;

app.post('/ask', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) {
    return res.status(400).json({ error: 'Missing prompt' });
  }
  const response = await ask(prompt, storageService);
  res.json({ response });
});

app.listen(PORT, () => {
  console.log(`Valac backend listening on port ${PORT}`);
});
