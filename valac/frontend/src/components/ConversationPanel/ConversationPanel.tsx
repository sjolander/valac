import { useConversation } from '../../services/ConversationContext';
import styles from './ConversationPanel.module.scss';
import React, { useState, useRef, useEffect } from 'react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneDark } from 'react-syntax-highlighter/dist/esm/styles/prism';
import ActionTrace from '../ActionTrace/ActionTrace';

export default function ConversationPanel() {
  const { conversation, askQuestion } = useConversation();
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [conversation?.messages]);

  if (!conversation) {
    return (
      <div className={styles.empty}>
        <p>Select or create a conversation to begin.</p>
      </div>
    );
  }

  const handleAsk = async () => {
    if (!input.trim() || isStreaming) return;
    const q = input;
    setInput('');
    setIsStreaming(true);
    await askQuestion(q);
    setIsStreaming(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleAsk();
    }
  };

  return (
    <div className={styles.panel}>
      <div className={styles.messages}>
        {conversation.messages.length === 0 && (
          <div className={styles.emptyChat}>Ask something to get started.</div>
        )}
        {conversation.messages.map((m) => (
          <div key={m.id} className={styles.messagePair}>
            <div className={styles.userMessage}>
              <span className={styles.label}>You</span>
              {m.prompt}
            </div>
            {m.actions && m.actions.length > 0 && (
              <ActionTrace actions={m.actions} hasResponse={!!m.response} />
            )}
            <div className={styles.assistantMessage}>
              <span className={styles.label}>Valac</span>
              {m.error ? (
                <span className={styles.errorText}>{m.error}</span>
              ) : m.status && !m.response ? (
                <span className={styles.statusText}>{m.status}</span>
              ) : (
                <ReactMarkdown
                  components={{
                    code({ node, className, children, ...props }) {
                      const match = /language-(\w+)/.exec(className || '');
                      const isInline = !match;
                      return isInline ? (
                        <code className={className} {...props}>
                          {children}
                        </code>
                      ) : (
                        <SyntaxHighlighter
                          style={oneDark}
                          language={match[1]}
                          PreTag="div"
                        >
                          {String(children).replace(/\n$/, '')}
                        </SyntaxHighlighter>
                      );
                    },
                  }}
                >
                  {m.response}
                </ReactMarkdown>
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className={styles.inputArea}>
        <textarea
          className={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Ask something… (Enter to send, Shift+Enter for newline)"
          rows={3}
          disabled={isStreaming}
        />
        <button
          className={styles.sendButton}
          onClick={handleAsk}
          disabled={isStreaming || !input.trim()}
        >
          {isStreaming ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  );
}
