import { useState } from 'react';
import { Modal } from '../components/Modal';

/** Mot de passe d'un PDF protégé (le PDF est ensuite gardé sans protection dans la bibliothèque). */
export function PasswordDialog({
  fileName,
  wrong,
  onSubmit,
  onCancel,
}: {
  fileName: string;
  wrong: boolean;
  onSubmit: (v: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState('');
  return (
    <Modal
      title="PDF protégé"
      onClose={onCancel}
      width={420}
      footer={
        <>
          <button type="button" className="nb-btn" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" form="pdf-password-form" className="nb-btn nb-btn--primary" disabled={!value}>
            Ouvrir
          </button>
        </>
      }
    >
      <form
        id="pdf-password-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (value) onSubmit(value);
        }}
      >
        <p className="nb-muted" style={{ marginTop: 0 }}>
          « {fileName} » demande un mot de passe pour s’ouvrir. Une fois ouvert, il est gardé sans mot de passe dans votre bibliothèque, sur votre serveur.
        </p>
        <label className="nb-field">
          <span>Mot de passe</span>
          <input className="nb-input" type="password" autoFocus value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off" />
        </label>
        {wrong ? <div className="nb-error">Mot de passe incorrect, réessayez.</div> : null}
      </form>
    </Modal>
  );
}

/** Nouveau nom d'un PDF. */
export function RenameDialog({ name, onSave, onClose }: { name: string; onSave: (name: string) => void; onClose: () => void }) {
  const [value, setValue] = useState(name);
  const clean = value.trim();
  return (
    <Modal
      title="Renommer le PDF"
      onClose={onClose}
      width={420}
      footer={
        <>
          <button type="button" className="nb-btn" onClick={onClose}>
            Annuler
          </button>
          <button type="submit" form="pdf-rename-form" className="nb-btn nb-btn--primary" disabled={!clean}>
            Renommer
          </button>
        </>
      }
    >
      <form
        id="pdf-rename-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (clean) onSave(clean.slice(0, 200));
        }}
      >
        <label className="nb-field">
          <span>Nom</span>
          <input className="nb-input" autoFocus value={value} onChange={(e) => setValue(e.target.value)} onFocus={(e) => e.target.select()} />
        </label>
      </form>
    </Modal>
  );
}
