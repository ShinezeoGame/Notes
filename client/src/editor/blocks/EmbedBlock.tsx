import { useState } from 'react';
import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react';
import type { BlockConfig } from '@blocknote/core';
import { normalizeEmbedUrl } from '../embed';
import { Icon } from '../../icons/Icon';
import { ResizableFrame } from '../resize';
import { t } from '../../lib/i18n';

const embedConfig = {
  type: 'embed',
  propSchema: {
    url: { default: '' },
    height: { default: 420 },
    width: { default: 100 },
    title: { default: '' },
  },
  content: 'none',
} as const satisfies BlockConfig;

type Props = ReactCustomBlockRenderProps<typeof embedConfig>;

function embedLabel(kind: string | undefined, url: string): string {
  if (kind === 'youtube') return 'YouTube';
  if (kind === 'gcal') return 'Google Agenda';
  try {
    return new URL(url).hostname;
  } catch {
    return t('Contenu intégré');
  }
}

function EmbedView({ block, editor }: Props) {
  const { url, height, width, title } = block.props;
  const editable = editor.isEditable;
  const [editing, setEditing] = useState(!url);
  const [draft, setDraft] = useState(url);
  const [error, setError] = useState('');

  const submit = () => {
    const info = normalizeEmbedUrl(draft);
    if (!info) {
      setError(t('Lien invalide. Collez une adresse commençant par http(s)://'));
      return;
    }
    const nextHeight = info.ratio ? Math.round(Math.min(720, Math.max(240, (window.innerWidth > 900 ? 720 : window.innerWidth - 80) / info.ratio))) : height;
    editor.updateBlock(block, { props: { url: draft.trim(), height: nextHeight } });
    setError('');
    setEditing(false);
  };

  if (editing || !url) {
    return (
      <div className="nb-file-placeholder nb-embed-form" contentEditable={false}>
        <div className="nb-placeholder-row">
          <span className="nb-placeholder-icon">
            <Icon name="video" size={20} />
          </span>
          <input
            className="nb-input"
            type="url"
            placeholder={t('Coller un lien YouTube, Vimeo, Google Agenda, Drive…')}
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
            {t('Intégrer')}
          </button>
          {url ? (
            <button type="button" className="nb-btn" onClick={() => setEditing(false)}>
              {t('Annuler')}
            </button>
          ) : null}
        </div>
        {error ? <div className="nb-error">{error}</div> : null}
      </div>
    );
  }

  const info = normalizeEmbedUrl(url);
  return (
    <ResizableFrame
      editable={editable}
      width={width}
      onWidthCommit={(pct) => editor.updateBlock(block, { props: { width: pct } })}
      height={height}
      minHeight={120}
      maxHeight={1600}
      onHeightCommit={(px) => editor.updateBlock(block, { props: { height: px } })}
      className="nb-embed"
    >
      {(liveHeight, resizing) => (
        <div contentEditable={false}>
          <div className="nb-media-toolbar">
            <span className="nb-media-title" title={url}>
              <Icon name="video" size={15} /> {title || embedLabel(info?.kind, url)}
            </span>
            <span className="nb-media-actions">
              <button type="button" onClick={() => window.open(url, '_blank', 'noopener')}>
                {t('Ouvrir')}
              </button>
              {editable ? (
                <button
                  type="button"
                  onClick={() => {
                    setDraft(url);
                    setEditing(true);
                  }}
                >
                  {t('Modifier')}
                </button>
              ) : null}
            </span>
          </div>
          <iframe
            className="nb-embed-frame"
            src={info?.src ?? url}
            style={{ height: liveHeight, pointerEvents: resizing ? 'none' : undefined }}
            title={title || t('Contenu intégré')}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      )}
    </ResizableFrame>
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
