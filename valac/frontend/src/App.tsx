import { useState } from 'react';
import axios from 'axios';

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
      const res = await axios.post('http://localhost:3000/ask', { prompt });
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
    <div style={{ padding: '2rem', fontFamily: 'sans-serif' }}>
      <h1>Valac Assistant</h1>
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
  );
}

export default App;