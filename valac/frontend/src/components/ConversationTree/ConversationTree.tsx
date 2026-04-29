import React from 'react';
import { useVault } from '../../contexts/VaultContext';
import { useConversation } from '../../services/ConversationContext';
import styles from './ConversationTree.module.scss';

export default function ConversationTree() {
  const {
    conversations,
    activeConversationId,
    setActiveConversationId,
    newConversation,
    deleteConversation,
  } = useVault();

  const handleNew = () => newConversation();

  const handleDelete = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    deleteConversation(id);
  };

  const sorted = [...conversations].sort((a, b) => b.lastUsed - a.lastUsed);

  return (
    <div className={styles.tree}>
      <div className={styles.header}>
        <span className={styles.title}>Conversations</span>
        <button
          className={styles.newButton}
          onClick={handleNew}
          title="New conversation"
        >
          +
        </button>
      </div>

      <div className={styles.list}>
        {sorted.length === 0 && (
          <div className={styles.empty}>No conversations yet.</div>
        )}
        {sorted.map((conv) => {
          const isActive = conv.id === activeConversationId;
          const tags = conv.tags ?? [];

          return (
            <div
              key={conv.id}
              className={`${styles.item} ${isActive ? styles.active : ''}`}
              onClick={() => setActiveConversationId(conv.id)}
            >
              <div className={styles.tags}>
                {tags.length > 0 ? (
                  tags.slice(0, 5).map((tag) => (
                    <span key={tag.id} className={styles.tag}>
                      {tag.name}
                    </span>
                  ))
                ) : (
                  <span className={styles.untitled}>New conversation</span>
                )}
              </div>
              <button
                className={styles.deleteButton}
                onClick={(e) => handleDelete(e, conv.id)}
                title="Delete"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
