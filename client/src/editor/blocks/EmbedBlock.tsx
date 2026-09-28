import { useEffect, useRef, useState } from 'react';
import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react';
import type { BlockConfig } from '@blocknote/core';
import { normalizeEmbedUrl } from '../embed';

const embedConfig = {
  type: 'embed',
  propSchema: {
    url: { default: '' },
    height: { default: 420 },
    title: { default: '' },
  },
  content: 'none',
} as const satisfies BlockConfig;

type Props = ReactCustomBlockRenderProps<typeof embedConfig>;

function EmbedView({ block, editor }: Props) {
  const { url, height, title } = block.props;
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(!url);
  const [draft, setDraft] = useState(url);
  const [error, setError] = useState('');
  const [liveHeight, setLiveHeight] = useState(height);
  const dragRef = useRef<{ startY: number; startH: number } | null>(null);

  useEffect(() => setLiveHeight(height), [height]);

  const submit = () => {
    const info = normalizeEmbedUrl(draft);
    if (!info) {
      setError('Lien invalide. Collez une adresse commençant par http(s)://');
      return;
    }
    const nextHeight = info.ratio ? Math.round(Math.min(720, Math.max(240, (window.innerWidth > 900 ? 720 : window.innerWidth - 80) / info.ratio))) : height;
    editor.updateBlock(block, { props: { url: draft.trim(), height: nextHeight } });
    setError('');
    setEditing(false);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!editable) return;
    dragRef.current = { startY: e.clientY, startH: liveHeight };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    setLiveHeight(Math.max(120, Math.min(1400, dragRef.current.startH + (e.clientY - dragRef.current.startY))));
  };
  const onPointerUp = () => {
    if (!dragRef.current) return;
    dragRef.current = null;
    if (liveHeight !== height) editor.updateBlock(block, { props: { height: liveHeight } });
  };

  if (editing || !url) {
    return (
      <div className="nb-file-placeholder nb-embed-form" contentEditable={false}>
        <div className="nb-placeholder-row">
          <span className="nb-placeholder-icon">🎬</span>
          <input
            className="nb-input"
            type="url"
            placeholder="Coller un lien YouTube, Vimeo, Google Agenda, Drive…"
            value={draft}
            disabled={!editable}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                submit();
              }
            }}
          />
          <button type="button" className="nb-btn nb-btn--primary" onClick={submit} disabled={!editable}>
            Intégrer
          </button>
          {url ? (
            <button type="button" className="nb-btn" onClick={() => setEditing(false)}>
              Annuler
            </button>
          ) : null}
        </div>
        {error ? <div className="nb-error">{error}</div> : null}
      </div>
    );
  }

  const info = normalizeEmbedUrl(url);
  return (
    <div className="nb-embed" contentEditable={false}>
      <div className="nb-media-toolbar">
        <span className="nb-media-title" title={url}>
          🎬 {title || info?.kind === 'youtube' ? 'YouTube' : info?.kind === 'gcal' ? 'Google Agenda' : new URL(url).hostname}
        </span>
        <span className="nb-media-actions">
          <button type="button" onClick={() => window.open(url, '_blank', 'noopener')}>
            Ouvrir
          </button>
          {editable ? (
            <button
              type="button"
              onClick={() => {
                setDraft(url);
                setEditing(true);
              }}
            >
              Modifier
            </button>
          ) : null}
        </span>
      </div>
      <iframe
        className="nb-embed-frame"
        src={info?.src ?? url}
        style={{ height: liveHeight }}
        title={title || 'Contenu intégré'}
        loading="lazy"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
      />
      {editable ? (
        <div
          className="nb-resize-handle"
          title="Glisser pour redimensionner"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        />
      ) : null}
    </div>
  );
}

export const EmbedBlock = createReactBlockSpec(embedConfig, {
  render: (props) => <EmbedView {...props} />,
  toExternalHTML: ({ block }) => (
    <a href={block.props.url} target="_blank" rel="noopener noreferrer">
      {block.props.url}
    </a>
  ),
});
