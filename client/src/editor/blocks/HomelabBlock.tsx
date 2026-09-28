import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react';
import type { BlockConfig } from '@blocknote/core';
import { HomelabPanel } from '../../components/HomelabView';
import { useAppCtx } from '../context';

const homelabConfig = {
  type: 'homelab',
  propSchema: { compact: { default: true } },
  content: 'none',
} as const satisfies BlockConfig;

function HomelabBlockView({ block, editor }: ReactCustomBlockRenderProps<typeof homelabConfig>) {
  const ctx = useAppCtx();
  if (ctx.mode !== 'owner') {
    return (
      <div className="nb-file-placeholder" contentEditable={false}>
        <div className="nb-placeholder-btn">🏠 Tableau de bord homelab (visible uniquement par le propriétaire de l’espace)</div>
      </div>
    );
  }
  return (
    <div className="nb-homelab-block" contentEditable={false}>
      <div className="nb-media-toolbar">
        <span className="nb-media-title">🏠 Homelab</span>
        <span className="nb-media-actions">
          {editor.isEditable ? (
            <button type="button" onClick={() => editor.updateBlock(block, { props: { compact: !block.props.compact } })}>
              {block.props.compact ? 'Vue détaillée' : 'Vue compacte'}
            </button>
          ) : null}
          <button type="button" onClick={() => ctx.openDashboard?.()}>
            Ouvrir
          </button>
        </span>
      </div>
      <div className="nb-homelab-body">
        <HomelabPanel compact={block.props.compact} configured={ctx.homelabConfigured ?? false} />
      </div>
    </div>
  );
}

export const HomelabBlock = createReactBlockSpec(homelabConfig, {
  render: (props) => <HomelabBlockView {...props} />,
  toExternalHTML: () => <p>Tableau de bord homelab</p>,
});
