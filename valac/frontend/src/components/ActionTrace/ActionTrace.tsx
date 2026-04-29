import React, { useState, useEffect } from 'react';
import styles from './ActionTrace.module.scss';

interface Props {
  actions: string[];
  hasResponse: boolean;
}

export default function ActionTrace({ actions, hasResponse }: Props) {
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    if (hasResponse) setCollapsed(true);
  }, [hasResponse]);

  if (actions.length === 0) return null;

  return (
    <div className={`${styles.trace} ${collapsed ? styles.collapsed : ''}`}>
      <button className={styles.header} onClick={() => setCollapsed((c) => !c)}>
        <span className={styles.icon}>{collapsed ? '▸' : '▾'}</span>
        <span className={styles.summary}>
          {collapsed
            ? `${actions.length} action${actions.length !== 1 ? 's' : ''} taken`
            : 'Valac is thinking…'}
        </span>
      </button>
      {!collapsed && (
        <ul className={styles.list}>
          {actions.map((a, i) => (
            <li key={i} className={styles.item}>
              <span className={styles.dot} />
              {a}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
