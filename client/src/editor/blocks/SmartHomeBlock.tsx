import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react';
import type { BlockConfig } from '@blocknote/core';
import { SmartHomePanel } from '../../components/SmartHomeView';
import { useAppCtx } from '../context';
import { Icon } from '../../icons/Icon';
import { ResizableFrame, normalizeWidth } from '../resize';
import { t } from '../../lib/i18n';

const smartHomeConfig = {
  type: 'smarthome',
  propSchema: { favoritesOnly: { default: true }, width: { default: 100 } },
  content: 'none',
} as const satisfies BlockConfig;

function SmartHomeBlockView({ block, editor }: ReactCustomBlockRenderProps<typeof smartHomeConfig>) {
  const ctx = useAppCtx();
  if (ctx.mode !== 'owner') {
    return (
      <div className="nb-file-placeholder" contentEditable={false}>
        <div className="nb-placeholder-btn">
          <Icon name="bulb" size={18} /> {t('Appareils de la maison, visibles uniquement par le propriétaire de l’espace')}
        </div>
      </div>
    );
  }
  const favoritesOnly = block.props.favoritesOnly;
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
              <Icon name="bulb" size={15} /> {t('Maison')}
              {favoritesOnly ? t(' · favoris') : ''}
            </span>
            <span className="nb-media-actions">
              {editor.isEditable ? (
                <button type="button" onClick={() => editor.updateBlock(block, { props: { favoritesOnly: !favoritesOnly } })}>
                  {favoritesOnly ? t('Tous les appareils') : t('Favoris seulement')}
                </button>
              ) : null}
              <button type="button" onClick={() => ctx.openSmartHome?.()}>
                {t('Ouvrir')}
              </button>
            </span>
          </div>
          <div className="nb-homelab-body">
            <SmartHomePanel doc={ctx.workspaceDoc ?? null} compact favoritesOnly={favoritesOnly} canConfigure={editor.isEditable} />
          </div>
        </div>
      )}
    </ResizableFrame>
  );
}

export const SmartHomeBlock = createReactBlockSpec(smartHomeConfig, {
  render: (props) => <SmartHomeBlockView {...props} />,
  toExternalHTML: () => <p>{t('Appareils de la maison')}</p>,
});
