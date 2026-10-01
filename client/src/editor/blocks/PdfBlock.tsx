import { useEffect, useRef, useState } from 'react';
import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react';
import type { BlockConfig } from '@blocknote/core';
import { useAppCtx } from '../context';
import { Icon } from '../../icons/Icon';
import { ResizableFrame, normalizeWidth } from '../resize';
import { t, tn } from '../../lib/i18n';

const pdfConfig = {
  type: 'pdf',
  propSchema: {
    name: { default: '' },
    url: { default: '' },
    caption: { default: '' },
    height: { default: 560 },
    width: { default: 100 },
  },
  content: 'none',
} as const satisfies BlockConfig;

type Props = ReactCustomBlockRenderProps<typeof pdfConfig>;

function PdfView({ block, editor }: Props) {
  const ctx = useAppCtx();
  const { url, name, height, width } = block.props;
  const editable = editor.isEditable;
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [numPages, setNumPages] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [uploading, setUploading] = useState(false);

  const pick = () => inputRef.current?.click();

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setUploading(true);
    try {
      const uploaded = await ctx.uploadFile(file);
      editor.updateBlock(block, { props: { url: uploaded, name: file.name } });
    } catch (err) {
      ctx.notify(err instanceof Error ? err.message : t('Téléversement impossible.'), 'error');
    } finally {
      setUploading(false);
    }
  };

  useEffect(() => {
    if (!url || !containerRef.current) return;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let doc: { loadingTask?: { destroy: () => Promise<void> }; destroy?: () => Promise<void>; cleanup?: () => Promise<void> } | undefined;
    setState('loading');
    (async () => {
      try {
        const { loadPdf, renderPdfInto } = await import('../pdf');
        const pdf = await loadPdf(url);
        doc = pdf;
        if (cancelled || !containerRef.current) return;
        setNumPages(pdf.numPages);
        cleanup = await renderPdfInto(pdf, containerRef.current);
        if (!cancelled) setState('ready');
      } catch (err) {
        console.warn('PDF illisible', err);
        if (!cancelled) setState('error');
      }
    })();
    return () => {
      cancelled = true;
      cleanup?.();
      void (doc?.destroy ? doc.destroy() : doc?.loadingTask?.destroy());
    };
    // Nouveau rendu quand la largeur change, pour que les pages remplissent le cadre.
  }, [url, width]);

  if (!url) {
    return (
      <div className="nb-file-placeholder" contentEditable={false}>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          style={{ display: 'none' }}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button type="button" className="nb-placeholder-btn" onClick={pick} disabled={!editable || uploading}>
          <span className="nb-placeholder-icon">
            <Icon name="filePdf" size={20} />
          </span>
          {uploading ? t('Téléversement…') : t('Ajouter un PDF')}
        </button>
      </div>
    );
  }

  return (
    <ResizableFrame
      editable={editable}
      width={normalizeWidth(width)}
      onWidthCommit={(pct) => editor.updateBlock(block, { props: { width: pct } })}
      height={height}
      minHeight={200}
      maxHeight={2400}
      onHeightCommit={(px) => editor.updateBlock(block, { props: { height: px } })}
      className="nb-pdf"
    >
      {(liveHeight) => (
    <div contentEditable={false}>
      <div className="nb-media-toolbar">
        <span className="nb-media-title" title={name}>
          <Icon name="filePdf" size={15} /> {name || t('Document PDF')}
          {numPages ? <span className="nb-muted"> · {tn(numPages, '{n} page', '{n} pages')}</span> : null}
        </span>
        <span className="nb-media-actions">
          <button type="button" onClick={() => setExpanded((v) => !v)}>
            {expanded ? t('Réduire') : t('Agrandir')}
          </button>
          <button type="button" onClick={() => window.open(url, '_blank', 'noopener')}>
            {t('Ouvrir')}
          </button>
          {editable ? (
            <>
              <input
                ref={inputRef}
                type="file"
                accept="application/pdf,.pdf"
                style={{ display: 'none' }}
                onChange={(e) => void onFile(e.target.files?.[0])}
              />
              <button type="button" onClick={pick} disabled={uploading}>
                {t('Remplacer')}
              </button>
            </>
          ) : null}
        </span>
      </div>
      <div className="nb-pdf-viewport" style={{ maxHeight: expanded ? 'none' : liveHeight }} ref={containerRef} />
      {state === 'loading' ? <div className="nb-media-status">{t('Chargement du PDF…')}</div> : null}
      {state === 'error' ? (
        <div className="nb-media-status">
          {t('Aperçu indisponible.')}{' '}
          <a href={url} target="_blank" rel="noopener noreferrer">
            {t('Ouvrir le fichier')}
          </a>
        </div>
      ) : null}
    </div>
      )}
    </ResizableFrame>
  );
}

export const PdfBlock = createReactBlockSpec(pdfConfig, {
  meta: { fileBlockAccept: ['application/pdf', '.pdf'] },
  render: (props) => <PdfView {...props} />,
  toExternalHTML: ({ block }) => (
    <a href={block.props.url} target="_blank" rel="noopener noreferrer">
      {block.props.name || t('Document PDF')}
    </a>
  ),
});
