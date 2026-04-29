import React, { useRef } from 'react';
import styles from './Button.module.scss';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  variant?: 'primary' | 'secondary';
}

export default function Button({ children, variant = 'primary', ...props }: ButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);

  const handleMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (!ref.current) return;

    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    ref.current.style.setProperty('--ripple-x', `${x}px`);
    ref.current.style.setProperty('--ripple-y', `${y}px`);
  };

  return (
    <button
      {...props}
      ref={ref}
      className={`${variant ? styles[variant] : 'primary'}`}
      onMouseEnter={handleMouseEnter}
    >
      {children}
    </button>
  );
}