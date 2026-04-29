import ConversationPanel from '../ConversationPanel/ConversationPanel';
import ConversationTree from '../ConversationTree/ConversationTree';

import styles from './ConversationViewer.module.scss';

export default function ConversationViewer() {
    return (
            <div className={styles.conversationViewer}>
                <ConversationTree />
                <ConversationPanel />
            </div>
    );
}