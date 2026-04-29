import MemoryViewer from "../MemoryViewer/MemoryViewer";
import ColorSwatch from "../ColorSwatch/ColorSwatch";
import Header from "../Header/Header"
import styles from './AppShell.module.scss';
import ConversationViewer from "../ConversationViewer/ConversationViewer";
import { VaultProvider } from "../../contexts/VaultContext";
import { ConversationProvider } from "../../services/ConversationContext";

export default function AppShell() {
  return (
    <VaultProvider>
      <ConversationProvider>
        <div className={styles.appShell}>
          <Header />
          <div className={styles.conversationRow}>
            <ConversationViewer />        
            <MemoryViewer />
          </div>
          {/* <ColorSwatch /> */}
        </div>
      </ConversationProvider>
    </VaultProvider>
  );
}
