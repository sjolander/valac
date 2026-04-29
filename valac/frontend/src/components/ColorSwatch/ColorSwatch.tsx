
import styles from './ColorSwatch.module.scss';

export default function ColorSwatch() {
    return (
        <div className={styles.colorSwatch}>
            <div className={`${styles.color} ${styles.lightText}`}>Light text</div>
            <div className={`${styles.color} ${styles.darkText}`}>Dark text</div>
            <div className={`${styles.color} ${styles.green}`}></div>
            <div className={`${styles.color} ${styles.purple}`}></div>
            <div className={`${styles.color} ${styles.red}`}></div>
            <div className={`${styles.color} ${styles.orange}`}></div>
            
        </div>
    )
}