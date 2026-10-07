import { useRef, useState } from 'react';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { Icon } from '../icons/Icon';
import type { ExportSize } from './exporter';
import { canShare, pdfFileName, saveFile, saveLabel, saveMode, shareFile } from './save';
import { fileSize } from '../lib/format';
import { getLang, t, tn } from '../lib/i18n';

/** Choix faits dans la fenêtre d'export. */
export type ExportChoices = {
  /** Seulement les pages sélectionnées dans l'éditeur. */
  onlySelected: boolean;
  /** Texte du filigrane ('' : sans filigrane). */
  watermark: string;
  /** Contenu masqué effacé pour de bon. */
  redact: boolean;
  size: ExportSize;
};

type Props = {
  name: string;
  pageCount: number;
  /** Pages sélectionnées dans l'éditeur (0 : pas de choix « sélection »). */
  selectedCount?: number;
  /** Le document a des zones couvertes avec « Masquer » (null : pas encore connu). */
  hasMasks?: boolean | null;
  /** Fabrique le PDF selon les choix. */
  build: (choices: ExportChoices, onProgress: (fraction: number, label: string) => void) => Promise<Uint8Array>;
  onClose: () => void;
};

/** Fenêtre « Exporter le PDF » : nom du fichier, pages, filigrane, masques, taille, enregistrement ou partage. */
export function ExportDialog({ name, pageCount, selectedCount = 0, hasMasks = false, build, onClose }: Props) {
  const [fileName, setFileName] = useState(() => pdfFileName(name));
  // Toutes les pages par défaut : n'exporter que la sélection est un choix explicite.
  const [onlySelected, setOnlySelected] = useState(false);
  const [marking, setMarking] = useState(false);
  const [watermark, setWatermark] = useState('');
  const [redact, setRedact] = useState(true);
  const [size, setSize] = useState<ExportSize>('normal');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ fraction: number; label: string } | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  // PDF déjà fabriqués, par choix (les trois derniers) : taille connue aussitôt en revenant à un choix.
  const cache = useRef(new Map<string, Uint8Array>());
  const [, setBuilt] = useState(0);
  const markInput = useRef<HTMLInputElement>(null);
  const mode = saveMode();
  const sharing = canShare();

  const choices: ExportChoices = { onlySelected, watermark: marking ? watermark.trim() : '', redact: Boolean(hasMasks) && redact, size };
  const key = JSON.stringify(choices);
  const known = cache.current.get(key)?.length ?? null;
  const images = Boolean(choices.watermark) || size === 'tiny';

  const bytes = async () => {
    const done = cache.current.get(key);
    if (done) return done;
    const out = await build(choices, (fraction, label) => setProgress({ fraction, label }));
    cache.current.set(key, out);
    if (cache.current.size > 3) cache.current.delete(cache.current.keys().next().value!);
    setBuilt((n) => n + 1);
    return out;
  };

  const ready = () => {
    if (marking && !watermark.trim()) {
      setError(t('Écrivez le texte du filigrane.'));
      markInput.current?.focus();
      return false;
    }
    return true;
  };

  /** Fabrique le PDF sans l'enregistrer, pour en connaître la taille (gardé pour l'enregistrement). */
  const measure = async () => {
    if (!ready()) return;
    setBusy(true);
    setError('');
    try {
      await bytes();
    } catch (err) {
      console.error(err);
      setError(err instanceof Error && err.message ? err.message : t('Export impossible.'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const run = async (action: 'save' | 'share') => {
    setError('');
    setNotice('');
    if (!ready()) return;
    setBusy(true);
    try {
      const data = await bytes();
      const file = pdfFileName(fileName);
      setProgress({ fraction: 1, label: action === 'save' ? t('Enregistrement…') : t('Partage…') });
      if (action === 'share') {
        if ((await shareFile(data, file)) === 'cancelled') return;
      } else {
        const result = await saveFile(data, file);
        if (result === 'cancelled') return;
        if (result === 'saved') toast(t('« {file} » est enregistré.', { file }));
        else if (result === 'downloaded') toast(t('« {file} » est dans vos téléchargements.', { file }));
        else
          toast(t('Le PDF s’ouvre dans le navigateur. Installez la dernière version de l’application pour l’enregistrer directement.'), 'info', {
            duration: 8000,
          });
      }
      onClose();
    } catch (err) {
      // Navigateur : le partage doit suivre de près le toucher ; le PDF (déjà prêt) part au toucher suivant.
      if (action === 'share' && (err as Error)?.name === 'NotAllowedError') {
        setNotice(t('Le PDF est prêt : touchez à nouveau « Partager ».'));
        return;
      }
      console.error(err);
      setError(err instanceof Error && err.message ? err.message : t('Export impossible.'));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Modal
      title={t('Exporter le PDF')}
      onClose={() => !busy && onClose()}
      width={480}
      footer={
        <>
          <button type="button" className="nb-btn" onClick={onClose} disabled={busy}>
            {t('Annuler')}
          </button>
          {sharing ? (
            <button type="button" className="nb-btn" onClick={() => void run('share')} disabled={busy}>
              <Icon name="share" size={15} /> {t('Partager…')}
            </button>
          ) : null}
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => void run('save')} disabled={busy}>
            <Icon name="download" size={15} /> {saveLabel(mode)}
          </button>
        </>
      }
    >
      <label className="nb-field">
        <span>{t('Nom du fichier')}</span>
        <input className="nb-input" value={fileName} onChange={(e) => setFileName(e.target.value)} disabled={busy} spellCheck={false} />
      </label>
      {selectedCount > 0 ? (
        <fieldset className="pdf-export-scope" disabled={busy}>
          <legend className="nb-sr-only">{t('Pages à exporter')}</legend>
          <label>
            <input type="radio" name="pdf-scope" checked={!onlySelected} onChange={() => setOnlySelected(false)} />
            {t('Toutes les pages ({n})', { n: pageCount })}
          </label>
          <label>
            <input type="radio" name="pdf-scope" checked={onlySelected} onChange={() => setOnlySelected(true)} />
            {t('Pages sélectionnées ({n})', { n: selectedCount })}
          </label>
        </fieldset>
      ) : (
        <p className="nb-muted pdf-export-note">
          {tn(pageCount, '{n} page, avec vos annotations et les formulaires remplis.', '{n} pages, avec vos annotations et les formulaires remplis.')}
        </p>
      )}

      <fieldset className="pdf-export-option" disabled={busy}>
        <label className="pdf-export-check">
          <input
            type="checkbox"
            checked={marking}
            onChange={(e) => {
              setMarking(e.target.checked);
              setError('');
              if (e.target.checked) setTimeout(() => markInput.current?.focus(), 0);
            }}
          />
          <span>{t('Ajouter un filigrane')}</span>
        </label>
        {marking ? (
          <>
            <input
              ref={markInput}
              className="nb-input"
              value={watermark}
              onChange={(e) => setWatermark(e.target.value)}
              maxLength={120}
              placeholder={t('Ex. : Copie pour l’agence Dupont, location, le {date}', { date: new Date().toLocaleDateString(getLang()) })}
              aria-label={t('Texte du filigrane')}
            />
            <p className="nb-muted pdf-export-hint">
              {t('Écrit en travers de chaque page et incrusté dans l’image. Indiquez à qui et pourquoi vous l’envoyez, avec la date : la copie ne pourra pas servir à autre chose.')}
            </p>
          </>
        ) : null}
      </fieldset>

      {hasMasks ? (
        <fieldset className="pdf-export-option" disabled={busy}>
          <label className="pdf-export-check">
            <input type="checkbox" checked={redact} onChange={(e) => setRedact(e.target.checked)} />
            <span>{t('Effacer pour de bon ce qui est masqué')}</span>
          </label>
          <p className="nb-muted pdf-export-hint">
            {redact
              ? t('Les pages concernées deviennent des images : le texte caché ne peut plus être retrouvé.')
              : t('Attention : le texte couvert reste dans le fichier, il peut être retrouvé en le copiant.')}
          </p>
        </fieldset>
      ) : null}

      <fieldset className="pdf-export-option" disabled={busy}>
        <legend className="pdf-export-legend">{t('Taille du fichier')}</legend>
        <div className="pdf-export-sizes">
          {(
            [
              ['normal', t('D’origine'), t('Qualité intacte.')],
              ['small', t('Réduite'), t('Photos et images allégées : pour l’envoyer par e-mail.')],
              ['tiny', t('Minimale'), t('Pages en images légères : pour les sites qui limitent la taille.')],
            ] as [ExportSize, string, string][]
          ).map(([id, label, hint]) => (
            <label key={id} className={`pdf-export-size${size === id ? ' pdf-export-size--on' : ''}`}>
              <input type="radio" name="pdf-size" checked={size === id} onChange={() => setSize(id)} />
              <b>{label}</b>
              <small>{hint}</small>
            </label>
          ))}
        </div>
        <div className="pdf-export-weight">
          {known != null ? (
            <span>{t('Taille du PDF : {size}', { size: fileSize(known) })}</span>
          ) : (
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => void measure()}>
              {t('Calculer la taille')}
            </button>
          )}
        </div>
        {images ? <p className="nb-muted pdf-export-hint">{t('Les pages deviennent des images : leur texte ne se sélectionne plus.')}</p> : null}
      </fieldset>

      {mode === 'legacy-app' ? (
        <p className="nb-muted pdf-export-note">
          {t(
            'Cette version de l’application ouvre le PDF dans le navigateur. La dernière version (à installer une fois) l’enregistre directement dans le dossier de votre choix.',
          )}
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
