import styles from './MemoryViewer.module.scss';
import { useVault } from '../../contexts/VaultContext';

export default function MemoryViewer() {
  const { conversations, activeConversationId, setActiveConversationId } =
    useVault();

  return (
    <div className={styles.viewer}>
      <div className={styles.heading}>Conversations</div>
      <div className={styles.list}>
        {[...conversations]
          .sort((a, b) => b.lastUsed - a.lastUsed)
          .map((c) => (
            <div
              key={c.id}
              className={`${styles.item} ${c.id === activeConversationId ? styles.active : ''}`}
              onClick={() => setActiveConversationId(c.id)}
            >
              {c.title ??
                (c.tags.length > 0
                  ? c.tags.map((t) => t.name).join(', ')
                  : '(untitled)')}
            </div>
          ))}
      </div>
    </div>
  );
}
