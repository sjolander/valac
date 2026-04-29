import type { Tag } from '../models/Tag';

export async function getTags() {
  return [
    { id: '1', name: 'Tag 1', lastUsed: Date.now() },
    { id: '2', name: 'Tag 2', lastUsed: Date.now() },
    { id: '3', name: 'Tag 3', lastUsed: Date.now() },
  ];
}
