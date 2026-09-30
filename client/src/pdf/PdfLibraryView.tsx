import { useEffect, useRef, useState } from 'react';
import { navigate } from '../lib/router';
import { useMediaQuery } from '../lib/hooks';
import { takeIncoming, useIncomingCount } from '../lib/incoming';
import { Icon } from '../icons/Icon';
import { toast } from '../components/Toast';
import { useLibrary, type PdfEntry, type PdfLibrary } from './model';
import { importFiles, isImageFile, isPdfFile, type AskPassword } from './importer';
import { createProject, mergeProjects, purgeProject, purgeStale, readProject, refreshThumbnail } from './projects';
import { ExportDialog } from './ExportDialog';
import { PasswordDialog, RenameDialog } from './dialogs';

const dateFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function when(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return `aujourd’hui, ${timeFmt.format(d)}`;
  const y = new Date(today);
  y.setDate(today.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `hier, ${timeFmt.format(d)}`;
  return dateFmt.format(d);
}

const baseName = (name: string) => name.replace(/\.pdf$/i, '').trim() || 'Document';
const photosName = () => `Photos du ${dateFmt.format(new Date())}`;

/** Bibliothèque de l'atelier PDF : import de PDF et de photos, assemblage, export, suppression. */
export function PdfLibraryView({ library }: { library: PdfLibrary }) {
  const all = useLibrary(library);
  const entries = all.filter((e) => !e.deleted);
  const [busy, setBusy] = useState<string | null>(null);
  const [password, setPassword] = useState<{ name: string; wrong: boolean; resolve: (v: string | null) => void } | null>(null);
  const [menu, setMenu] = useState<{ entry: PdfEntry; x: number; y: number } | null>(null);
  const [renaming, setRenaming] = useState<PdfEntry | null>(null);
  const [exporting, setExporting] = useState<PdfEntry | null>(null);
  const [merging, setMerging] = useState(false);
  const [picked, setPicked] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const pdfInput = useRef<HTMLInputElement>(null);
  const photoInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);
  const touch = useMediaQuery('(pointer: coarse)');
  const thumbsAsked = useRef(new Set<string>());
  const incoming = useIncomingCount();

  useEffect(() => {
    document.title = 'Atelier PDF – Melo';
    purgeStale(library);
  }, [library]);

  // Miniatures manquantes (PDF créé sur un autre appareil hors connexion, par exemple).
  useEffect(() => {
    for (const e of entries) {
      if (e.thumb || e.pages === 0 || thumbsAsked.current.has(e.id)) continue;
      thumbsAsked.current.add(e.id);
      void refreshThumbnail(library, e.id);
    }
  }, [entries, library]);

  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('pointerdown', close);
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('pointerdown', close);
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  const askPassword: AskPassword = (name, wrong) => new Promise((resolve) => setPassword({ name, wrong, resolve }));

  /** PDF : un document chacun ; photos : un seul document, une page par photo. */
  const importNow = async (files: File[]) => {
    const pdfs = files.filter(isPdfFile);
    const photos = files.filter((f) => !isPdfFile(f) && isImageFile(f));
    const ignored = files.filter((f) => !isPdfFile(f) && !isImageFile(f));
    if (ignored.length) toast(`Fichier ignoré : ${ignored.map((f) => f.name).join(', ')} (seuls les PDF et les photos sont acceptés).`, 'error');
    if (pdfs.length + photos.length === 0) return;
    const created: string[] = [];
    try {
      for (const file of pdfs) {
        const r = await importFiles([file], { askPassword, onProgress: setBusy });
        if (r.pages.length === 0) continue;
        created.push(await createProject(library, baseName(file.name), r, r.files));
      }
      if (photos.length) {
        const r = await importFiles(photos, { askPassword, onProgress: setBusy });
        if (r.pages.length)
          created.push(await createProject(library, photos.length === 1 ? baseName(photos[0].name.replace(/\.[^.]+$/, '')) : photosName(), r, r.files));
      }
    } catch (err) {
      console.error(err);
      toast(err instanceof Error && err.message ? err.message : 'Import impossible.', 'error');
    } finally {
      setBusy(null);
    }
    if (created.length === 1) navigate({ name: 'pdf', pdfId: created[0] });
    else if (created.length > 1) toast(`${created.length} PDF importés.`);
  };

  useEffect(() => {
    if (incoming > 0 && !busy) void importNow(takeIncoming());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incoming, busy]);

  const remove = (e: PdfEntry) => {
    library.setDeleted(e.id, true);
    let undone = false;
    toast(`« ${e.name} » est supprimé.`, 'info', {
      duration: 8000,
      action: {
        label: 'Annuler',
        run: () => {
          undone = true;
          library.setDeleted(e.id, false);
        },
      },
    });
    setTimeout(() => {
      if (!undone && library.get(e.id)?.deleted) void purgeProject(library, e.id).catch((err) => console.warn('PDF : suppression différée', err));
    }, 8500);
  };

  const merge = async () => {
    const chosen = picked.map((id) => library.get(id)).filter((e): e is PdfEntry => Boolean(e));
    if (chosen.length < 2) return;
    setBusy('Assemblage…');
    try {
      const id = await mergeProjects(
        library,
        chosen.map((e) => e.id),
        `${chosen[0].name} (assemblé)`,
      );
      setMerging(false);
      setPicked([]);
      navigate({ name: 'pdf', pdfId: id });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Assemblage impossible.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const open = (e: PdfEntry) => {
    if (merging) setPicked((p) => (p.includes(e.id) ? p.filter((x) => x !== e.id) : [...p, e.id]));
    else navigate({ name: 'pdf', pdfId: e.id });
  };

  return (
    <div
      className={`nb-page pdf-lib${dragOver ? ' pdf-lib--drop' : ''}`}
      onDragOver={(ev) => {
        if (!ev.dataTransfer.types.includes('Files')) return;
        ev.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={(ev) => {
        if (ev.currentTarget === ev.target) setDragOver(false);
      }}
      onDrop={(ev) => {
        if (!ev.dataTransfer.files.length) return;
        ev.preventDefault();
        setDragOver(false);
        void importNow(Array.from(ev.dataTransfer.files));
      }}
    >
      <h1 className="nb-page-title-static">
        <Icon name="filePdf" size={34} /> Atelier PDF
      </h1>
      <p className="nb-muted pdf-lib-intro">
        Importez un PDF pour réorganiser ses pages, l’annoter, le signer ou remplir ses formulaires, puis exportez-le. L’original n’est jamais modifié.
      </p>

      <input
        ref={pdfInput}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(ev) => {
          const files = Array.from(ev.target.files ?? []);
          ev.target.value = '';
          void importNow(files);
        }}
      />
      <input
        ref={photoInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(ev) => {
          const files = Array.from(ev.target.files ?? []);
          ev.target.value = '';
          void importNow(files);
        }}
      />

      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(ev) => {
          const files = Array.from(ev.target.files ?? []);
          ev.target.value = '';
          void importNow(files);
        }}
      />

      <div className="pdf-lib-actions">
        <button type="button" className="nb-btn nb-btn--primary" onClick={() => pdfInput.current?.click()} disabled={Boolean(busy)}>
          <Icon name="upload" size={16} /> Importer des PDF
        </button>
        <button type="button" className="nb-btn" onClick={() => photoInput.current?.click()} disabled={Boolean(busy)}>
          <Icon name="image" size={16} /> Photos → PDF
        </button>
        {touch ? (
          <button type="button" className="nb-btn" onClick={() => cameraInput.current?.click()} disabled={Boolean(busy)}>
            <Icon name="camera" size={16} /> Scanner un document
          </button>
        ) : null}
        {entries.length > 1 ? (
          <button
            type="button"
            className={`nb-btn${merging ? ' nb-btn--active' : ''}`}
            aria-pressed={merging}
            onClick={() => {
              setMerging((v) => !v);
              setPicked([]);
            }}
            disabled={Boolean(busy)}
          >
            <Icon name="copy" size={16} /> Assembler des PDF
          </button>
        ) : null}
      </div>

      {busy ? (
        <div className="pdf-busy" role="status">
          <span className="pdf-spinner" aria-hidden="true" /> {busy}
        </div>
      ) : null}

      {merging ? (
        <div className="pdf-merge-bar">
          <span>{picked.length === 0 ? 'Touchez les PDF à assembler, dans l’ordre voulu.' : `${picked.length} PDF choisi${picked.length > 1 ? 's' : ''}`}</span>
          <button
            type="button"
            className="nb-btn"
            onClick={() => {
              setMerging(false);
              setPicked([]);
            }}
          >
            Annuler
          </button>
          <button type="button" className="nb-btn nb-btn--primary" disabled={picked.length < 2 || Boolean(busy)} onClick={() => void merge()}>
            Assembler
          </button>
        </div>
      ) : null}

      {entries.length === 0 ? (
        <div className="pdf-empty">
          <Icon name="filePdf" size={44} />
          <p>Aucun PDF pour l’instant.</p>
          <p className="nb-muted">Importez un PDF, créez-en un à partir de photos, ou déposez des fichiers ici.</p>
        </div>
      ) : (
        <ul className="pdf-grid" aria-label="Vos PDF">
          {entries.map((e) => {
            const order = picked.indexOf(e.id);
            return (
              <li key={e.id} className={`pdf-card${order >= 0 ? ' pdf-card--picked' : ''}`}>
                <button type="button" className="pdf-card-open" onClick={() => open(e)} aria-label={merging ? `Choisir « ${e.name} »` : `Ouvrir « ${e.name} »`}>
                  <span className="pdf-card-thumb">{e.thumb ? <img src={e.thumb} alt="" /> : <Icon name="filePdf" size={36} />}</span>
                  <span className="pdf-card-name" title={e.name}>
                    {e.name}
                  </span>
                  <span className="pdf-card-meta">
                    {e.pages} page{e.pages > 1 ? 's' : ''} · {when(e.updatedAt)}
                  </span>
                  {merging ? <span className="pdf-card-check">{order >= 0 ? order + 1 : ''}</span> : null}
                </button>
                {!merging ? (
                  <button
                    type="button"
                    className="nb-icon-btn pdf-card-more"
                    aria-label={`Plus d’options pour « ${e.name} »`}
                    onPointerDown={(ev) => ev.stopPropagation()}
                    onClick={(ev) => {
                      const r = ev.currentTarget.getBoundingClientRect();
                      setMenu({ entry: e, x: r.right - 210, y: r.bottom + 4 });
                    }}
                  >
                    <Icon name="dots" size={18} />
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {menu ? (
        <div
          className="nb-menu"
          role="menu"
          style={{ left: Math.max(8, Math.min(menu.x, window.innerWidth - 220)), top: Math.min(menu.y, window.innerHeight - 170) }}
          onPointerDown={(ev) => ev.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => (setMenu(null), navigate({ name: 'pdf', pdfId: menu.entry.id }))}>
            <Icon name="pencil" size={16} /> Ouvrir
          </button>
          <button type="button" role="menuitem" onClick={() => (setMenu(null), setRenaming(menu.entry))}>
            <Icon name="textSize" size={16} /> Renommer
          </button>
          <button type="button" role="menuitem" onClick={() => (setMenu(null), setExporting(menu.entry))}>
            <Icon name="download" size={16} /> Exporter
          </button>
          <button type="button" role="menuitem" className="nb-menu-danger" onClick={() => (setMenu(null), remove(menu.entry))}>
            <Icon name="trash" size={16} /> Supprimer
          </button>
        </div>
      ) : null}

      {renaming ? (
        <RenameDialog
          name={renaming.name}
          onClose={() => setRenaming(null)}
          onSave={(name) => {
            library.update(renaming.id, { name });
            setRenaming(null);
          }}
        />
      ) : null}
      {exporting ? (
        <ExportDialog
          name={exporting.name}
          pageCount={exporting.pages}
          build={async (_sel, onProgress) => {
            const { exportPdf } = await import('./exporter');
            return exportPdf(await readProject(exporting.id), { title: exporting.name, onProgress });
          }}
          onClose={() => setExporting(null)}
        />
      ) : null}
      {password ? (
        <PasswordDialog
          fileName={password.name}
          wrong={password.wrong}
          onSubmit={(value) => {
            password.resolve(value);
            setPassword(null);
          }}
          onCancel={() => {
            password.resolve(null);
            setPassword(null);
          }}
        />
      ) : null}
    </div>
  );
}
