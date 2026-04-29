import type { Conversation } from '../models/Conversation';

export const dummyConversations: Conversation[] = [
  {
    id: 'c1',
    title: 'Project Kickoff',
    lastUsed: Date.now() - 1000 * 60 * 60 * 2, // 2 hours ago
    tags: [
      { id: 't1', name: 'work', lastUsed: Date.now() - 1000 * 60 * 60 * 2 },
      { id: 't2', name: 'planning', lastUsed: Date.now() - 1000 * 60 * 60 * 2 },
    ],
    messages: [
      {
        id: 'm1',
        timestamp: Date.now() - 1000 * 60 * 60 * 5, // 5 hours ago
        prompt: 'When is the project kickoff meeting?',
        response: 'Tomorrow at 10 AM with the full team.',
      },
      {
        id: 'm2',
        timestamp: Date.now() - 1000 * 60 * 60 * 4, // 4 hours ago
        prompt: 'Who is leading it?',
        response: 'Sarah will be leading the kickoff session.',
      },
    ],
  },
  {
    id: 'c2',
    // no title → will fall back to showing tags
    lastUsed: Date.now() - 1000 * 60 * 30, // 30 minutes ago
    tags: [
      { id: 't3', name: 'personal', lastUsed: Date.now() - 1000 * 60 * 30 },
    ],
    messages: [
      {
        id: 'm3',
        timestamp: Date.now() - 1000 * 60 * 60 * 1, // 1 hour ago
        prompt: 'What’s a good dinner recipe with chicken?',
        response: 'Try lemon garlic chicken with roasted vegetables.',
      },
      {
        id: 'm4',
        timestamp: Date.now() - 1000 * 60 * 20, // 20 minutes ago
        prompt: 'Can I prep it ahead of time?',
        response: 'Yes, you can marinate the chicken overnight.',
      },
    ],
  },
];

export async function getConversations(): Promise<Conversation[]> {
  return Promise.resolve(dummyConversations);
}
