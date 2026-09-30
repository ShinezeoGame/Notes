import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ownerAuth } from '../lib/api';
import { useDocHandle } from '../lib/hooks';
import { navigate } from '../lib/router';
import { useSettings } from '../lib/settings';
import { Icon } from '../icons/Icon';
import { toast } from '../components/Toast';
import { LOCAL, PdfProject, pdfRoom, useLibrary, useProject, type PdfEntry, type PdfLibrary } from './model';
import { SourceCache, thumbnail } from './render';
import { importFiles, type AskPassword } from './importer';
import { copyContent, createProject } from './projects';
import { ExportDialog } from './ExportDialog';
import { PasswordDialog } from './dialogs';
import { PagesView } from './PagesView';
import { AnnotateView } from './AnnotateView';

const isTyping = (el: Element | null) => Boolean(el?.closest('input, textarea, select, [contenteditable="true"]'));

/** Éditeur d'un PDF de la bibliothèque. */
export function PdfEditor({ library, id }: { library: PdfLibrary; id: string }) {
  const settings = useSettings();
  const entry = useLibrary(library).find((e) => e.id === id);
  const { handle, ready } = useDocHandle(pdfRoom(settings.workspaceId, id), ownerAuth(), true);
  const project = useMemo(() => (handle ? new PdfProject(handle.doc) : null), [handle]);
  useEffect(() => () => project?.destroy(), [project]);
  const cache = useMemo(() => new SourceCache(), []);
  useEffect(() => () => cache.destroy(), [cache]);

  useEffect(() => {
    document.title = `${entry?.name ?? 'PDF'} – Melo`;
  }, [entry?.name]);

  if (!entry || entry.deleted) {
    return (
      <div className="nb-page">
        <div className="nb-card">
          <h1>PDF introuvable</h1>
          <p className="nb-muted">Ce PDF n’existe pas ou a été supprimé.</p>
          <button type="button" className="nb-btn nb-btn--primary" onClick={() => navigate('#/pdf')}>
            Retour à la bibliothèque
          </button>
        </div>
      </div>
    );
  }
  if (!project || !ready) return <div className="pdf-loading nb-muted">Ouverture du PDF…</div>;
  return <EditorBody library={library} entry={entry} project={project} cache={cache} />;
}

function EditorBody({ library, entry, project, cache }: { library: PdfLibrary; entry: PdfEntry; project: PdfProject; cache: SourceCache }) {
  const state = useProject(project);
  const [mode, setMode] = useState<'pages' | 'annotate'>('annotate');
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [focus, setFocus] = useState<{ pageId: string; seq: number } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [password, setPassword] = useState<{ name: string; wrong: boolean; resolve: (v: string | null) => void } | null>(null);
  const [name, setName] = useState<string | null>(null);

  // Bibliothèque tenue à jour : nombre de pages, date de modification, miniature.
  useEffect(() => {
    if (state.pages.length && state.pages.length !== entry.pages) library.update(entry.id, { pages: state.pages.length });
  }, [state.pages.length, entry.pages, entry.id, library]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin !== LOCAL && !(origin instanceof Object && 'undoStack' in origin)) return;
      clearTimeout(timer);
      timer = setTimeout(() => library.update(entry.id, {}), 2000);
    };
    project.doc.on('update', onUpdate);
    return () => {
      clearTimeout(timer);
      project.doc.off('update', onUpdate);
    };
  }, [project, library, entry.id]);

  const first = state.pages[0];
  const firstKey = first ? `${first.src}:${first.index}:${first.rot}:${JSON.stringify(first.crop ?? null)}` : '';
  const thumbKey = useRef<string | null>(null);
  useEffect(() => {
    if (!first) return;
    if (thumbKey.current === null && entry.thumb) {
      thumbKey.current = firstKey;
      return;
    }
    if (thumbKey.current === firstKey) return;
    thumbKey.current = firstKey;
    const src = first.src ? state.sources.get(first.src) : undefined;
    const timer = setTimeout(() => {
      thumbnail(cache, first, src).then(
        (thumb) => library.update(entry.id, { thumb }),
        (err) => console.warn('PDF : miniature impossible', err),
      );
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey]);

  // Annuler / rétablir au clavier (hors saisie de texte, qui garde son propre historique).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || isTyping(document.activeElement)) return;
      const k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault();
        project.undo.undo();
      } else if (k === 'y' || (k === 'z' && e.shiftKey)) {
        e.preventDefault();
        project.undo.redo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project]);

  const askPassword: AskPassword = (fileName, wrong) => new Promise((resolve) => setPassword({ name: fileName, wrong, resolve }));

  const addFiles = async (files: File[], at: number) => {
    try {
      const r = await importFiles(files, { askPassword, onProgress: setBusy });
      if (r.skipped.length) toast(`Fichier ignoré : ${r.skipped.join(', ')}`, 'error');
      if (r.pages.length === 0) return;
      project.addPages(r.sources, r.pages, at);
      library.addFiles(entry.id, r.files);
      setSelection(new Set(r.pages.map((p) => p.id)));
      toast(`${r.pages.length} page${r.pages.length > 1 ? 's' : ''} ajoutée${r.pages.length > 1 ? 's' : ''}.`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Ajout impossible.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const extract = async (pageIds: string[]) => {
    setBusy('Création du nouveau PDF…');
    try {
      const newId = await createProject(library, `${entry.name} (extrait)`, copyContent([{ state, pageIds }]), entry.files);
      toast(`Nouveau PDF créé avec ${pageIds.length} page${pageIds.length > 1 ? 's' : ''}.`, 'info', {
        duration: 8000,
        action: { label: 'Ouvrir', run: () => navigate({ name: 'pdf', pdfId: newId }) },
      });
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Extraction impossible.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const openPage = useCallback((pageId: string) => {
    setMode('annotate');
    setFocus((f) => ({ pageId, seq: (f?.seq ?? 0) + 1 }));
  }, []);

  const commitName = () => {
    const clean = (name ?? '').trim();
    if (name !== null && clean && clean !== entry.name) library.update(entry.id, { name: clean.slice(0, 200) });
    setName(null);
  };

  const waiting = state.pages.length === 0;

  return (
    <div className="pdfe">
      <header className="pdfe-head">
        <button type="button" className="nb-icon-btn" aria-label="Retour à la bibliothèque" title="Retour à la bibliothèque" onClick={() => navigate('#/pdf')}>
          <Icon name="chevronLeft" size={20} />
        </button>
        <input
          className="pdfe-name"
          aria-label="Nom du PDF"
          value={name ?? entry.name}
          onFocus={() => setName(entry.name)}
          onChange={(e) => setName(e.target.value)}
          onBlur={commitName}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
            if (e.key === 'Escape') {
              setName(entry.name);
              e.currentTarget.blur();
            }
          }}
        />
        <div className="pdfe-modes" role="tablist" aria-label="Affichage">
          <button type="button" role="tab" aria-selected={mode === 'pages'} className={mode === 'pages' ? 'active' : ''} onClick={() => setMode('pages')}>
            <Icon name="grid" size={15} /> Pages
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'annotate'}
            className={mode === 'annotate' ? 'active' : ''}
            onClick={() => setMode('annotate')}
          >
            <Icon name="pencil" size={15} /> Annoter
          </button>
        </div>
        <div className="pdfe-actions">
          <button
            type="button"
            className="nb-icon-btn"
            aria-label="Annuler"
            title="Annuler (Ctrl+Z)"
            disabled={!project.canUndo}
            onClick={() => project.undo.undo()}
          >
            <Icon name="undo" size={18} />
          </button>
          <button
            type="button"
            className="nb-icon-btn"
            aria-label="Rétablir"
            title="Rétablir (Ctrl+Y)"
            disabled={!project.canRedo}
            onClick={() => project.undo.redo()}
          >
            <Icon name="redo" size={18} />
          </button>
          <button type="button" className="nb-btn nb-btn--primary nb-btn--sm" onClick={() => setExporting(true)} disabled={waiting}>
            <Icon name="download" size={15} /> Exporter
          </button>
        </div>
      </header>
      {busy ? (
        <div className="pdf-busy pdf-busy--bar" role="status">
          <span className="pdf-spinner" aria-hidden="true" /> {busy}
        </div>
      ) : null}
      <div className={`pdfe-body pdfe-body--${mode}`}>
        {waiting ? (
          <div className="pdf-loading nb-muted">Récupération du PDF depuis le serveur…</div>
        ) : mode === 'pages' ? (
          <PagesView
            project={project}
            state={state}
            cache={cache}
            selection={selection}
            onSelection={setSelection}
            onOpenPage={openPage}
            onAddFiles={(files, at) => void addFiles(files, at)}
            onExtract={(ids) => void extract(ids)}
            busy={Boolean(busy)}
          />
        ) : (
          <AnnotateView
            project={project}
            state={state}
            cache={cache}
            workspaceDoc={library.doc}
            onFiles={(paths) => library.addFiles(entry.id, paths)}
            focus={focus}
          />
        )}
      </div>
      {exporting ? (
        <ExportDialog
          name={entry.name}
          pageCount={state.pages.length}
          selectedCount={mode === 'pages' ? selection.size : 0}
          build={async (onlySelected, onProgress) => {
            const { exportPdf } = await import('./exporter');
            const pageIds = onlySelected ? state.pages.filter((p) => selection.has(p.id)).map((p) => p.id) : undefined;
            return exportPdf(state, { pageIds, title: entry.name, onProgress });
          }}
          onClose={() => setExporting(false)}
        />
      ) : null}
      {password ? (
        <PasswordDialog
          fileName={password.name}
          wrong={password.wrong}
          onSubmit={(v) => {
            password.resolve(v);
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
