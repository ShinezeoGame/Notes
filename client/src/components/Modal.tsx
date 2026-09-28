import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
};

export function Modal({ title, onClose, children, footer, width = 540 }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <div
      className="nb-modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="nb-modal" role="dialog" aria-modal="true" aria-label={title} style={{ maxWidth: width }}>
        <div className="nb-modal-head">
          <h2>{title}</h2>
          <button type="button" className="nb-icon-btn" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="nb-modal-body">{children}</div>
        {footer ? <div className="nb-modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
