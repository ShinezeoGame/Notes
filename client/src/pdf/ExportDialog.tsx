import { useRef, useState } from 'react';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { Icon } from '../icons/Icon';
import { canShare, pdfFileName, saveFile, saveLabel, saveMode, shareFile } from './save';

type Props = {
  name: string;
  pageCount: number;
  /** Pages sélectionnées dans l'éditeur (0 : pas de choix « sélection »). */
  selectedCount?: number;
  /** Fabrique le PDF (toutes les pages, ou seulement la sélection). */
  build: (onlySelected: boolean, onProgress: (fraction: number, label: string) => void) => Promise<Uint8Array>;
  onClose: () => void;
};

/** Fenêtre « Exporter le PDF » : nom du fichier, pages, enregistrement ou partage. */
export function ExportDialog({ name, pageCount, selectedCount = 0, build, onClose }: Props) {
  const [fileName, setFileName] = useState(() => pdfFileName(name));
  // Toutes les pages par défaut : n'exporter que la sélection est un choix explicite.
  const [onlySelected, setOnlySelected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ fraction: number; label: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const cache = useRef<{ key: string; bytes: Uint8Array } | null>(null);
  const mode = saveMode();
  const sharing = canShare();

  const bytes = async () => {
    const key = String(onlySelected);
    if (cache.current?.key === key) return cache.current.bytes;
    const out = await build(onlySelected, (fraction, label) => setProgress({ fraction, label }));
    cache.current = { key, bytes: out };
    return out;
  };

  const run = async (action: 'save' | 'share') => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const data = await bytes();
      const file = pdfFileName(fileName);
      setProgress({ fraction: 1, label: action === 'save' ? 'Enregistrement…' : 'Partage…' });
      if (action === 'share') {
        if ((await shareFile(data, file)) === 'cancelled') return;
      } else {
        const result = await saveFile(data, file);
        if (result === 'cancelled') return;
        if (result === 'saved') toast(`« ${file} » est enregistré.`);
        else if (result === 'downloaded') toast(`« ${file} » est dans vos téléchargements.`);
        else
          toast('Le PDF s’ouvre dans le navigateur. Installez la dernière version de l’application pour l’enregistrer directement.', 'info', {
            duration: 8000,
          });
      }
      onClose();
    } catch (err) {
      // Navigateur : le partage doit suivre de près le toucher ; le PDF (déjà prêt) part au toucher suivant.
      if (action === 'share' && (err as Error)?.name === 'NotAllowedError') {
        setNotice('Le PDF est prêt : touchez à nouveau « Partager ».');
        return;
      }
      console.error(err);
      setError(err instanceof Error && err.message ? err.message : 'Export impossible.');
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Modal
      title="Exporter le PDF"
      onClose={() => !busy && onClose()}
      width={460}
      footer={
        <>
          <button type="button" className="nb-btn" onClick={onClose} disabled={busy}>
            Annuler
          </button>
          {sharing ? (
            <button type="button" className="nb-btn" onClick={() => void run('share')} disabled={busy}>
              <Icon name="share" size={15} /> Partager…
            </button>
          ) : null}
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => void run('save')} disabled={busy}>
            <Icon name="download" size={15} /> {saveLabel(mode)}
          </button>
        </>
      }
    >
      <label className="nb-field">
        <span>Nom du fichier</span>
        <input className="nb-input" value={fileName} onChange={(e) => setFileName(e.target.value)} disabled={busy} spellCheck={false} />
      </label>
      {selectedCount > 0 ? (
        <fieldset className="pdf-export-scope" disabled={busy}>
          <legend className="nb-sr-only">Pages à exporter</legend>
          <label>
            <input
              type="radio"
              name="pdf-scope"
              checked={!onlySelected}
              onChange={() => {
                setOnlySelected(false);
              }}
            />
            Toutes les pages ({pageCount})
          </label>
          <label>
            <input type="radio" name="pdf-scope" checked={onlySelected} onChange={() => setOnlySelected(true)} />
            Pages sélectionnées ({selectedCount})
          </label>
        </fieldset>
      ) : (
        <p className="nb-muted pdf-export-note">
          {pageCount} page{pageCount > 1 ? 's' : ''}, avec vos annotations et les formulaires remplis.
        </p>
      )}
      {mode === 'legacy-app' ? (
        <p className="nb-muted pdf-export-note">
          Cette version de l’application ouvre le PDF dans le navigateur. La dernière version (à installer une fois) l’enregistre directement dans le dossier de
          votre choix.
        </p>
      ) : null}
      {progress ? (
        <div className="pdf-progress" role="status">
          <div className="pdf-progress-bar">
            <span style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
          </div>
          <span className="nb-muted">{progress.label}</span>
        </div>
      ) : null}
      {notice ? <div className="nb-success">{notice}</div> : null}
      {error ? <div className="nb-error">{error}</div> : null}
    </Modal>
  );
}
