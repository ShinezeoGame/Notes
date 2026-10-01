import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react';
import type { BlockConfig } from '@blocknote/core';
import { HomelabPanel } from '../../components/HomelabView';
import { useAppCtx } from '../context';
import { cardLayout, cardOrder, saveCardOrder, saveCardSize, useHomelabConfig } from '../../lib/homelab';
import { Icon } from '../../icons/Icon';
import { ResizableFrame, normalizeWidth } from '../resize';
import { t } from '../../lib/i18n';

const homelabConfig = {
  type: 'homelab',
  propSchema: { compact: { default: true }, width: { default: 100 } },
  content: 'none',
} as const satisfies BlockConfig;

function HomelabBlockView({ block, editor }: ReactCustomBlockRenderProps<typeof homelabConfig>) {
  const ctx = useAppCtx();
  const doc = ctx.workspaceDoc ?? null;
  const cfg = useHomelabConfig(doc);
  if (ctx.mode !== 'owner') {
    return (
      <div className="nb-file-placeholder" contentEditable={false}>
        <div className="nb-placeholder-btn">
          <Icon name="home" size={18} /> {t('Tableau de bord homelab, visible uniquement par le propriétaire de l’espace')}
        </div>
      </div>
    );
  }
  return (
    <ResizableFrame
      editable={editor.isEditable}
      width={normalizeWidth(block.props.width)}
      onWidthCommit={(pct) => editor.updateBlock(block, { props: { width: pct } })}
      className="nb-homelab-block"
    >
      {() => (
        <div contentEditable={false}>
          <div className="nb-media-toolbar">
            <span className="nb-media-title">
              <Icon name="home" size={15} /> {t('Homelab')}
            </span>
            <span className="nb-media-actions">
              {editor.isEditable ? (
                <button type="button" onClick={() => editor.updateBlock(block, { props: { compact: !block.props.compact } })}>
                  {block.props.compact ? t('Vue détaillée') : t('Vue compacte')}
                </button>
              ) : null}
              <button type="button" onClick={() => ctx.openDashboard?.()}>
                {t('Ouvrir')}
              </button>
            </span>
          </div>
          <div className="nb-homelab-body">
            <HomelabPanel
              compact={block.props.compact}
              configured={ctx.homelabConfigured ?? false}
              layout={cardLayout(cfg)}
              onResize={doc && editor.isEditable ? (id, size) => saveCardSize(doc, id, size) : undefined}
              order={cardOrder(cfg)}
              onReorder={doc && editor.isEditable ? (ids) => saveCardOrder(doc, ids) : undefined}
              grouped={cfg.grouped}
            />
          </div>
        </div>
      )}
    </ResizableFrame>
  );
}

export const HomelabBlock = createReactBlockSpec(homelabConfig, {
  render: (props) => <HomelabBlockView {...props} />,
  toExternalHTML: () => <p>{t('Tableau de bord homelab')}</p>,
});
