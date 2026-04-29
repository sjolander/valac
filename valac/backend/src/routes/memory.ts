import express from 'express';
import storage from '../services/StorageInstance.js';
const router = express.Router();

router.get('/metadata', async (req, res) => {
  try {
    const metadata = await storage.getMetadata();
    res.json(metadata);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch memory metadata');
  }
});

router.get('/tags', async (req, res) => {
  try {
    const tagsWithCounts = await storage.getAllTagsWithCounts();
    const tagsArray = Array.from(tagsWithCounts, ([tag, count]) => ({
      tag,
      count,
    }));
    res.json(tagsArray);
  } catch (err) {
    console.error(err);
    res.status(500).send('Failed to fetch tags');
  }
});

export default router;
