// Section Papiers : les documents importants de la maison (identité, véhicules, logement, santé…), avec leurs photos
// ou PDF, leur échéance et leurs rappels. Rangés par catégorie ou par personne ; ceux à renouveler en tête.
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type * as Y from 'yjs';
import { serverBase } from '../lib/api';
import { AppContext } from '../editor/context';
import { useMediaQuery } from '../lib/hooks';
import { navigate } from '../lib/router';
import { Icon } from '../icons/Icon';
import { Modal } from '../components/Modal';
import { toast } from '../components/Toast';
import { NeedsServerIntro, SectionIntro, hideSection } from '../components/SectionIntro';
import { canShare, saveFile, shareFile } from '../pdf/save';
import { fileSize } from '../lib/format';
import { refreshReminders } from '../lib/reminders';
import { t, tn } from '../lib/i18n';
import { DueBadge } from './due';
import {
  CATEGORIES,
  REMIND_CHOICES,
  TEMPLATES,
  category,
  newPaper,
  papersToRenew,
  removePaper,
  savePaper,
  usePapers,
  type Paper,
  type PaperCategory,
  type PaperFile,
} from './model';
import { deletePaperFile, isImage, isPdf, paperBlob, uploadPaperFile, usePaperFileUrl } from './files';

function Thumb({ file }: { file: PaperFile | undefined }) {
  const { url } = usePaperFileUrl(file && isImage(file) ? file.name : null);
  if (!file) return null;
  if (url) return <img className="pp-thumb" src={url} alt="" />;
  return (
    <span className="pp-thumb pp-thumb--icon">
      <Icon name={isPdf(file) ? 'filePdf' : 'file'} size={18} />
    </span>
  );
}

function PaperCard({ paper, onOpen }: { paper: Paper; onOpen: () => void }) {
  const cat = category(paper.category);
  return (
    <button type="button" className="pp-card" onClick={onOpen}>
      <span className="pp-card-icon">
        <Icon name={cat.icon} size={20} />
      </span>
      <span className="pp-card-body">
        <b className="pp-card-title">{paper.title || t('Sans titre')}</b>
        <span className="pp-card-meta">
          {[paper.person, paper.number].filter(Boolean).join(' · ') || cat.label}
        </span>
        <DueBadge paper={paper} />
      </span>
      {paper.files.length ? (
        <span className="pp-card-files">
          <Thumb file={paper.files.find(isImage) ?? paper.files[0]} />
          {paper.files.length > 1 ? <span className="pp-card-count">+{paper.files.length - 1}</span> : null}
        </span>
      ) : null}
    </button>
  );
}

/** Fichier ouvert en grand : photo ou PDF, avec Enregistrer et Partager. */
function FileViewer({ file, onClose }: { file: PaperFile; onClose: () => void }) {
  const { url, error } = usePaperFileUrl(file.name);
  const [busy, setBusy] = useState(false);
  const bytes = async () => new Uint8Array(await (await paperBlob(file.name)).arrayBuffer());
  const save = async () => {
    setBusy(true);
    try {
      const ext = isPdf(file) ? '.pdf' : file.type === 'image/png' ? '.png' : '.jpg';
      const result = await saveFile(await bytes(), file.label, { mime: file.type, ext, description: file.label });
      if (result === 'saved') toast(t('« {file} » est enregistré.', { file: file.label }));
      else if (result === 'downloaded') toast(t('« {file} » est dans vos téléchargements.', { file: file.label }));
    } catch (err) {
      toast(err instanceof Error ? err.message : t('Enregistrement impossible.'), 'error');
    } finally {
      setBusy(false);
    }
  };
  const share = async () => {
    setBusy(true);
    try {
      await shareFile(await bytes(), file.label, file.type);
    } catch (err) {
      toast(err instanceof Error ? err.message : t('Partage impossible.'), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={file.label}
      onClose={onClose}
      width={900}
      footer={
        <>
          {canShare() ? (
            <button type="button" className="nb-btn" onClick={() => void share()} disabled={busy || !url}>
              <Icon name="share" size={15} /> {t('Partager…')}
            </button>
          ) : null}
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => void save()} disabled={busy || !url}>
            <Icon name="download" size={15} /> {t('Enregistrer…')}
          </button>
        </>
      }
    >
      <div className="pp-viewer">
        {error ? (
          <div className="nb-error">{error}</div>
        ) : !url ? (
          <p className="nb-muted">{t('Chargement…')}</p>
        ) : isImage(file) ? (
          <img src={url} alt={file.label} />
        ) : isPdf(file) ? (
          <object data={url} type="application/pdf" aria-label={file.label}>
            <p className="nb-muted">{t('Aperçu indisponible sur cet appareil : enregistrez le fichier pour l’ouvrir.')}</p>
          </object>
        ) : (
          <p className="nb-muted">{t('Aperçu indisponible : enregistrez le fichier pour l’ouvrir.')}</p>
        )}
      </div>
    </Modal>
  );
}

/** Fiche d'un papier : nom, catégorie, personne, numéro, échéance et rappels, fichiers, notes. */
function PaperDialog({ doc, initial, isNew, people, onClose }: { doc: Y.Doc; initial: Paper; isNew: boolean; people: string[]; onClose: () => void }) {
  const [paper, setPaper] = useState<Paper>(initial);
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(0);
  const [viewing, setViewing] = useState<PaperFile | null>(null);
  const [template, setTemplate] = useState<string | null>(null);
  // Fichiers envoyés pendant cette modification (effacés si on annule) et retirés (effacés à l'enregistrement).
  const added = useRef<string[]>([]);
  const removed = useRef<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const titleInput = useRef<HTMLInputElement>(null);
  const touch = useMediaQuery('(pointer: coarse)');
  const set = (patch: Partial<Paper>) => setPaper((p) => ({ ...p, ...patch }));

  const cancel = () => {
    for (const name of added.current) void deletePaperFile(name);
    onClose();
  };
  const save = () => {
    if (!paper.title.trim()) {
      setError(t('Donnez un nom à ce papier.'));
      titleInput.current?.focus();
      return;
    }
    savePaper(doc, { ...paper, title: paper.title.trim(), person: paper.person.trim(), number: paper.number.trim(), remind: paper.expires ? paper.remind : [] });
    for (const name of removed.current) void deletePaperFile(name);
    refreshReminders();
    toast(isNew ? t('« {name} » est rangé.', { name: paper.title.trim() }) : t('Modifications enregistrées.'));
    onClose();
  };
  const remove = () => {
    if (!confirm(t('Supprimer « {name} » et ses fichiers ?', { name: paper.title || t('Sans titre') }))) return;
    removePaper(doc, paper.id);
    for (const f of [...initial.files, ...paper.files]) void deletePaperFile(f.name);
    refreshReminders();
    toast(t('Papier supprimé.'));
    onClose();
  };
  const addFiles = async (list: FileList | null) => {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError('');
    setUploading((n) => n + files.length);
    for (const file of files) {
      try {
        const f = await uploadPaperFile(file);
        added.current.push(f.name);
        setPaper((p) => ({ ...p, files: [...p.files, f] }));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('Envoi impossible.'));
      } finally {
        setUploading((n) => n - 1);
      }
    }
  };
  const dropFile = (f: PaperFile) => {
    if (added.current.includes(f.name)) {
      added.current = added.current.filter((n) => n !== f.name);
      void deletePaperFile(f.name);
    } else removed.current.push(f.name);
    set({ files: paper.files.filter((x) => x.name !== f.name) });
  };
  const pickTemplate = (tpl: (typeof TEMPLATES)[number]) => {
    setTemplate(tpl.title);
    set({ title: !paper.title || paper.title === template ? tpl.title : paper.title, category: tpl.category, remind: tpl.remind });
  };
  const toggleRemind = (days: number) =>
    set({ remind: paper.remind.includes(days) ? paper.remind.filter((d) => d !== days) : [...paper.remind, days].sort((a, b) => b - a) });

  return (
    <Modal
      title={isNew ? t('Nouveau papier') : paper.title || t('Papier')}
      onClose={cancel}
      width={600}
      footer={
        <>
          {!isNew ? (
            <button type="button" className="nb-btn nb-btn--danger pp-delete" onClick={remove}>
              <Icon name="trash" size={15} /> {t('Supprimer')}
            </button>
          ) : null}
          <button type="button" className="nb-btn" onClick={cancel}>
            {t('Annuler')}
          </button>
          <button type="button" className="nb-btn nb-btn--primary" onClick={save} disabled={uploading > 0}>
            {uploading > 0 ? t('Envoi…') : t('Enregistrer')}
          </button>
        </>
      }
    >
      {isNew ? (
        <div className="pp-templates" role="group" aria-label={t('Modèles')}>
          {TEMPLATES.map((tpl) => (
            <button
              key={tpl.title}
              type="button"
              className={`pp-chip${template === tpl.title ? ' pp-chip--on' : ''}`}
              onClick={() => pickTemplate(tpl)}
            >
              <Icon name={category(tpl.category).icon} size={13} /> {tpl.title}
            </button>
          ))}
        </div>
      ) : null}
      <label className="nb-field">
        <span>{t('Nom')}</span>
        <input
          ref={titleInput}
          className="nb-input"
          value={paper.title}
          onChange={(e) => set({ title: e.target.value })}
          placeholder={t('Ex. : Passeport, Carte grise de la Clio…')}
          maxLength={200}
          autoFocus={!isNew}
        />
      </label>
      <div className="pp-row">
        <label className="nb-field">
          <span>{t('Catégorie')}</span>
          <select className="nb-input" value={paper.category} onChange={(e) => set({ category: e.target.value as PaperCategory })}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
        <label className="nb-field">
          <span>{t('Pour qui ? (facultatif)')}</span>
          <input className="nb-input" value={paper.person} onChange={(e) => set({ person: e.target.value })} list="pp-people" maxLength={100} />
          <datalist id="pp-people">
            {people.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </label>
      </div>
      <div className="pp-row">
        <label className="nb-field">
          <span>{t('Date d’expiration ou d’échéance')}</span>
          <input className="nb-input" type="date" value={paper.expires} onChange={(e) => set({ expires: e.target.value })} />
        </label>
        <label className="nb-field">
          <span>{t('Numéro (facultatif)')}</span>
          <input className="nb-input" value={paper.number} onChange={(e) => set({ number: e.target.value })} maxLength={100} spellCheck={false} />
        </label>
      </div>
      {paper.expires ? (
        <fieldset className="pp-remind">
          <legend>{t('Me le rappeler')}</legend>
          <div className="pp-remind-chips">
            {REMIND_CHOICES.map((c) => (
              <label key={c.days} className={`pp-chip${paper.remind.includes(c.days) ? ' pp-chip--on' : ''}`}>
                <input type="checkbox" checked={paper.remind.includes(c.days)} onChange={() => toggleRemind(c.days)} />
                {c.label}
              </label>
            ))}
          </div>
          <p className="nb-muted pp-hint">{t('À 9 h, sur les appareils où les rappels sont activés (Réglages → Rappels).')}</p>
        </fieldset>
      ) : null}

      <div className="pp-files-head">
        <span>{t('Photos et PDF')}</span>
        <span className="pp-files-actions">
          {touch ? (
            <button type="button" className="nb-btn nb-btn--sm" onClick={() => cameraInput.current?.click()} disabled={uploading > 0}>
              <Icon name="camera" size={14} /> {t('Prendre une photo')}
            </button>
          ) : null}
          <button type="button" className="nb-btn nb-btn--sm" onClick={() => fileInput.current?.click()} disabled={uploading > 0}>
            <Icon name="plus" size={14} /> {t('Ajouter un fichier')}
          </button>
        </span>
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
        <input
          ref={cameraInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          onChange={(e) => {
            void addFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {paper.files.length || uploading ? (
        <div className="pp-files">
          {paper.files.map((f) => (
            <div key={f.name} className="pp-file">
              <button type="button" className="pp-file-open" onClick={() => setViewing(f)} title={f.label}>
                <Thumb file={f} />
                <span className="pp-file-name">{f.label}</span>
                <span className="nb-muted pp-file-size">{fileSize(f.size)}</span>
              </button>
              <button type="button" className="nb-icon-btn nb-icon-btn--sm pp-file-remove" onClick={() => dropFile(f)} title={t('Retirer')}>
                <Icon name="close" size={14} />
              </button>
            </div>
          ))}
          {uploading ? (
            <div className="pp-file pp-file--busy" role="status">
              {tn(uploading, 'Envoi de {n} fichier…', 'Envoi de {n} fichiers…')}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="nb-muted pp-hint">{t('Photographiez le recto et le verso, ou ajoutez le PDF reçu par e-mail.')}</p>
      )}

      <label className="nb-field">
        <span>{t('Notes (facultatif)')}</span>
        <textarea className="nb-input pp-notes" value={paper.notes} onChange={(e) => set({ notes: e.target.value })} rows={2} maxLength={5000} />
      </label>
      {error ? <div className="nb-error">{error}</div> : null}
      {viewing ? <FileViewer file={viewing} onClose={() => setViewing(null)} /> : null}
    </Modal>
  );
}

type Grouping = 'category' | 'person';

export default function PapersView({ doc, paperId }: { doc: Y.Doc; paperId: string | null }) {
  const ctx = useContext(AppContext);
  const papers = usePapers(doc);
  const [query, setQuery] = useState('');
  const [grouping, setGrouping] = useState<Grouping>('category');
  const [creating, setCreating] = useState<Paper | null>(null);

  useEffect(() => {
    document.title = t('Papiers – Ostal');
  }, []);
  // Adresse « #/papiers/nouveau » (widget de l'accueil) : fiche d'un nouveau papier.
  useEffect(() => {
    if (paperId === 'nouveau') {
      setCreating(newPaper());
      navigate('#/papiers', { replace: true });
    }
  }, [paperId]);

  const people = useMemo(() => [...new Set(papers.map((p) => p.person).filter(Boolean))].sort((a, b) => a.localeCompare(b)), [papers]);
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? papers.filter((p) => [p.title, p.person, p.number, p.notes, category(p.category).label].some((s) => s.toLowerCase().includes(q)))
      : papers;
    return [...list].sort((a, b) => a.title.localeCompare(b.title));
  }, [papers, query]);
  const renew = useMemo(() => (query ? [] : papersToRenew(papers)), [papers, query]);
  const groups = useMemo(() => {
    if (grouping === 'category')
      return CATEGORIES.map((c) => ({ key: c.id, label: c.label, icon: c.icon, list: shown.filter((p) => p.category === c.id) })).filter((g) => g.list.length);
    const names = [...new Set(shown.map((p) => p.person))].sort((a, b) => (!a ? 1 : !b ? -1 : a.localeCompare(b)));
    return names.map((n) => ({ key: n || '-', label: n || t('Toute la maison'), icon: n ? ('user' as const) : ('home' as const), list: shown.filter((p) => p.person === n) }));
  }, [shown, grouping]);

  const open = papers.find((p) => p.id === paperId) ?? null;
  const close = () => navigate('#/papiers', { replace: true });
  const hide = () => hideSection(doc, 'papers');

  if (!serverBase()) {
    return (
      <div className="nb-page">
        <h1 className="nb-page-title-static">
          <Icon name="papers" size={34} /> {t('Papiers')}
        </h1>
        <NeedsServerIntro
          icon="papers"
          title={t('Tous vos papiers importants, à portée de main')}
          need={t('Un serveur Ostal (chez vous ou chez un proche) : c’est lui qui garde vos papiers, à l’abri.')}
          onJoin={ctx?.joinServer}
          onHide={hide}
        >
          {t('Carte d’identité, carte grise, assurances, garanties… : photos et PDF rangés, retrouvés en un instant, et un rappel avant chaque échéance.')}
        </NeedsServerIntro>
      </div>
    );
  }

  const add = () => setCreating(newPaper());
  return (
    <div className="nb-page pp-page">
      <div className="pp-head">
        <h1 className="nb-page-title-static">
          <Icon name="papers" size={34} /> {t('Papiers')}
        </h1>
        {papers.length ? (
          <div className="pp-toolbar">
            <input
              className="nb-input pp-search"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('Rechercher un papier')}
              aria-label={t('Rechercher un papier')}
            />
            <div className="ag-seg" role="tablist" aria-label={t('Classement')}>
              {(
                [
                  ['category', t('Par catégorie')],
                  ['person', t('Par personne')],
                ] as [Grouping, string][]
              ).map(([id, label]) => (
                <button key={id} type="button" role="tab" aria-selected={grouping === id} className={grouping === id ? 'ag-seg--on' : ''} onClick={() => setGrouping(id)}>
                  {label}
                </button>
              ))}
            </div>
            <button type="button" className="nb-btn nb-btn--sm nb-btn--primary" onClick={add}>
              <Icon name="plus" size={14} /> {t('Ajouter un papier')}
            </button>
          </div>
        ) : null}
      </div>

      {!papers.length ? (
        <SectionIntro
          icon="papers"
          title={t('Tous vos papiers importants, à portée de main')}
          needs={[t('Une photo ou le PDF de vos documents : carte d’identité, carte grise, assurances, garanties…')]}
          actions={
            <button type="button" className="nb-btn nb-btn--primary" onClick={add}>
              <Icon name="plus" size={15} /> {t('Ajouter un papier')}
            </button>
          }
          note={t('Les fichiers restent sur votre serveur Ostal : seuls vos appareils y ont accès.')}
          onHide={hide}
        >
          {t('Rangez vos documents par catégorie ou par personne, retrouvez-les en un instant (même à la mairie ou au garage), et recevez un rappel avant chaque échéance : passeport, contrôle technique, assurance…')}
        </SectionIntro>
      ) : (
        <>
          {renew.length ? (
            <section className="pp-group pp-group--renew">
              <h2>
                <Icon name="bell" size={16} /> {t('À renouveler')}
              </h2>
              <div className="pp-grid">
                {renew.map((p) => (
                  <PaperCard key={p.id} paper={p} onOpen={() => navigate(`#/papiers/${p.id}`)} />
                ))}
              </div>
            </section>
          ) : null}
          {groups.map((g) => (
            <section key={g.key} className="pp-group">
              <h2>
                <Icon name={g.icon} size={16} /> {g.label}
                <span className="nb-muted pp-count">{g.list.length}</span>
              </h2>
              <div className="pp-grid">
                {g.list.map((p) => (
                  <PaperCard key={p.id} paper={p} onOpen={() => navigate(`#/papiers/${p.id}`)} />
                ))}
              </div>
            </section>
          ))}
          {!shown.length ? <p className="nb-muted">{t('Aucun papier ne correspond à « {query} ».', { query })}</p> : null}
        </>
      )}

      {open ? <PaperDialog key={open.id} doc={doc} initial={open} isNew={false} people={people} onClose={close} /> : null}
      {creating ? <PaperDialog key={creating.id} doc={doc} initial={creating} isNew people={people} onClose={() => setCreating(null)} /> : null}
    </div>
  );
}
