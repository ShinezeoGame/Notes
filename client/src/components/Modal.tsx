import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../icons/Icon';

type Props = {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
};

/** Fenêtres ouvertes, la plus récente en dernier : Échap ne ferme que celle du dessus (recadrage ouvert depuis des réglages…). */
const openModals: object[] = [];

export function Modal({ title, onClose, children, footer, width = 540 }: Props) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const me = {};
    openModals.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && openModals[openModals.length - 1] === me) closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = openModals.indexOf(me);
      if (i >= 0) openModals.splice(i, 1);
    };
  }, []);

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
            <Icon name="close" size={18} />
          </button>
        </div>
        <div className="nb-modal-body">{children}</div>
        {footer ? <div className="nb-modal-foot">{footer}</div> : null}
      </div>
    </div>,
    document.body,
  );
}
