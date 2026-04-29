import { useState } from 'react';
import axios from 'axios';
import MemoryViewer from './MemoryViewer';
import './App.css';
import AppShell from './components/AppShell/AppShell';

const API_URL = import.meta.env.VITE_API_URL;

function App() {
  const [prompt, setPrompt] = useState('');
  const [response, setResponse] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    setLoading(true);
    setResponse('');
    setError(null);
    try {
      const res = await axios.post(`${API_URL}/ask`, { prompt });
      setResponse(res.data.response);
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        setError(err.message || 'Something went wrong');
      } else {
        setError('Something went wrong');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <AppShell></AppShell>
      {/* <div class="appView">
      <div>
        <h1></h1>
        <textarea
          rows={4}
          cols={50}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Enter your prompt..."
          />
        <br />
        <button onClick={ask} disabled={loading}>
          {loading ? 'Thinking...' : 'Ask'}
        </button>
        {error && <p style={{ color: 'red' }}>{error}</p>}
        {response && (
          <div style={{ marginTop: '1rem', whiteSpace: 'pre-wrap' }}>
            <strong>Response:</strong>
            <p>{response}</p>
          </div>
        )}
      </div>
    </div> */}
    </>
  );
}

export default App;
