import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react';
import type { BlockConfig } from '@blocknote/core';
import { CamerasPanel } from '../../components/CamerasView';
import { useCamerasConfig } from '../../lib/cameras';
import { useAppCtx } from '../context';
import { Icon } from '../../icons/Icon';
import { ResizableFrame, normalizeWidth } from '../resize';
import { t } from '../../lib/i18n';

const cameraConfig = {
  type: 'camera',
  // cameraId vide : toutes les caméras.
  propSchema: { cameraId: { default: '' }, width: { default: 100 } },
  content: 'none',
} as const satisfies BlockConfig;

function CameraBlockView({ block, editor }: ReactCustomBlockRenderProps<typeof cameraConfig>) {
  const ctx = useAppCtx();
  const doc = ctx.workspaceDoc ?? null;
  const cfg = useCamerasConfig(doc);
  if (ctx.mode !== 'owner') {
    return (
      <div className="nb-file-placeholder" contentEditable={false}>
        <div className="nb-placeholder-btn">
          <Icon name="cctv" size={18} /> {t('Caméra de surveillance, visible uniquement par le propriétaire de l’espace')}
        </div>
      </div>
    );
  }
  const cameraId = block.props.cameraId;
  const camera = cfg.cameras.find((c) => c.id === cameraId);
  return (
    <ResizableFrame
      editable={editor.isEditable}
      width={normalizeWidth(block.props.width)}
      onWidthCommit={(pct) => editor.updateBlock(block, { props: { width: pct } })}
      className="nb-homelab-block"
    >
      {() => (
        <div contentEditable={false}>
          <div className="nb-media-toolbar cam-block-toolbar">
            <span className="nb-media-title">
              <Icon name="cctv" size={15} />
              {/* Liste de choix à la place du titre : le bandeau tient même dans une colonne étroite. */}
              {editor.isEditable && cfg.cameras.length > 1 ? (
                <select
                  className="nb-media-select"
                  value={camera ? cameraId : ''}
                  onChange={(ev) => editor.updateBlock(block, { props: { cameraId: ev.target.value } })}
                  aria-label={t('Caméra affichée')}
                >
                  <option value="">{t('Toutes les caméras')}</option>
                  {cfg.cameras.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="cam-block-name">{camera ? camera.name : cameraId ? t('Caméra') : t('Caméras')}</span>
              )}
            </span>
            <span className="nb-media-actions">
              <button type="button" onClick={() => ctx.openCameras?.()}>
                {t('Ouvrir')}
              </button>
            </span>
          </div>
          <div className="nb-homelab-body cam-block-body">
            <CamerasPanel doc={doc} cameraId={cameraId || undefined} compact canConfigure={editor.isEditable} />
          </div>
        </div>
      )}
    </ResizableFrame>
  );
}

export const CameraBlock = createReactBlockSpec(cameraConfig, {
  render: (props) => <CameraBlockView {...props} />,
  toExternalHTML: () => <p>{t('Caméra de surveillance')}</p>,
});
