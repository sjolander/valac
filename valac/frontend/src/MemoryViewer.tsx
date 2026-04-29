import { useEffect, useState } from 'react';
import './MemoryViewer.css';

const API_URL = import.meta.env.VITE_API_URL;

export default function MemoryViewer() {
  const [metadata, setMetadata] = useState<any>('');
  const [tags, setTags] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(false);

  useEffect(() => {
    let isMounted = true;
    const fetchData = async () => {
      setLoading(true);
      try {
        await getMetadata();
        await getTags();
      } catch (error) {
        if (isMounted) {
          console.error('Error fetching data:', error);
        }
      } finally {
        setLoading(false);
      }
    };
    fetchData();
    return () => {
      isMounted = false;
    };
  }, []);

  const getMetadata = async () => {
    try {
      const response = await fetch(`${API_URL}/memory/metadata`);
      setMetadata(await response.json());
    } catch (error) {
      console.error('Error fetching metadata:', error);
    }
  };

  const getTags = async () => {
    try {
      const response = await fetch(`${API_URL}/memory/tags`);
      setTags(await response.json());
    } catch (error) {
      console.error('Error fetching tags:', error);
    }
  };

  return (
    <>
      <span class="title" style={{ color: metadata?.status }}>
        Memory Metadata
      </span>
      <button onClick={getMetadata}>Refresh</button>
      <br />
      {loading && <p>Loading...</p>}
      {metadata?.points_count
        ? `Number of memories: ${metadata.points_count}`
        : ''}
      {tags.length > 0 &&
        tags.map((tagObj, index) => (
          <div key={index}>
            {tagObj.tag}: {tagObj.count}
          </div>
        ))}
      <br />

      {/* {metadata && <pre>{JSON.stringify(metadata, null, 2)}</pre>} */}
    </>
  );
}
