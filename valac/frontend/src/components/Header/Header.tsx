import { useVault } from '../../contexts/VaultContext';
import Button from '../Button/Button';
import styles from './Header.module.scss';

export default function Header() {
  const { newConversation } = useVault();
  return (
    <div className={styles.header}>
      <span className={styles.logo}>VALAC</span>
      <div className={styles.actions}>
        <Button variant="secondary" onClick={newConversation}>
          New Conversation
        </Button>
        <Button variant="secondary">Global Search</Button>
        <Button variant="secondary">Settings</Button>
      </div>
    </div>
  );
}
