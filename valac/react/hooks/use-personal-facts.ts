import { PersonalFact } from '@/components/topic-graph';
import { useState, useEffect, useCallback } from 'react';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export function usePersonalFacts(userId: string = 'default') {
  const [facts, setFacts] = useState<PersonalFact[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API}/personal-facts?user_id=${userId}`);
      const data = await res.json();
      setFacts(data);
    } catch (err) {
      console.error('usePersonalFacts: fetch failed', err);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { facts, loading, refresh };
}
