// Recadrage d'une image d'une page : bouton « Recadrer » de la barre de mise en forme (image sélectionnée) et fenêtre
// de recadrage, affichée hors de la barre (qui disparaît quand l'éditeur perd le focus). L'image recadrée remplace
// l'originale dans le bloc ; Ctrl+Z revient à l'originale.
import { createContext, useContext } from 'react';
import { useBlockNoteEditor, useComponentsContext, useSelectedBlocks } from '@blocknote/react';
import type { BlockNoteEditor } from '@blocknote/core';
import { ImageCropDialog, renderCropArea, type CropState } from '../components/ImageCropDialog';
import { Icon } from '../icons/Icon';
import { t } from '../lib/i18n';

type AnyEditor = BlockNoteEditor<any, any, any>;
type LooseBlock = { id: string; type: string; props: Record<string, unknown> };

export type ImageCropRequest = { blockId: string; src: string };

/** Demande de recadrage, transmise par l'éditeur à la barre de mise en forme. */
export const ImageCropContext = createContext<(req: ImageCropRequest) => void>(() => {});

/** Formats proposés (0 : celui de l'image d'origine). */
const FORMATS = [
  { label: t('Original'), aspect: 0 },
  { label: t('Carré'), aspect: 1 },
  { label: '4:3', aspect: 4 / 3 },
  { label: '3:2', aspect: 3 / 2 },
  { label: '16:9', aspect: 16 / 9 },
  { label: '3:4', aspect: 3 / 4 },
  { label: '9:16', aspect: 9 / 16 },
];

/** Bouton « Recadrer » de la barre de mise en forme, quand une seule image est sélectionnée. */
export function ImageCropButton() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor() as AnyEditor;
  const blocks = useSelectedBlocks(editor) as LooseBlock[];
  const request = useContext(ImageCropContext);
  if (!editor.isEditable || blocks.length !== 1) return null;
  const block = blocks[0];
  const url = typeof block.props.url === 'string' ? block.props.url : '';
  if (block.type !== 'image' || !url) return null;
  return (
    <Components.FormattingToolbar.Button
      className="bn-button"
      label={t('Recadrer')}
      mainTooltip={t('Recadrer l’image')}
      icon={<Icon name="crop" size={16} />}
      onClick={() => request({ blockId: block.id, src: url })}
    />
  );
}

/** Fenêtre de recadrage d'une image de la page ; l'image recadrée est envoyée puis remplace l'originale. */
export function NoteImageCrop({
  editor,
  req,
  upload,
  onClose,
}: {
  editor: AnyEditor;
  req: ImageCropRequest;
  upload: (file: File) => Promise<string>;
  onClose: () => void;
}) {
  const finish = async (img: HTMLImageElement, crop: CropState | null, aspect: number) => {
    if (!crop) return onClose();
    // Transparence gardée (logo, capture…) : PNG ; photo : JPEG.
    const transparent = /\.(png|webp|gif|svg)(\?|$)/i.test(req.src) || /^data:image\/(png|webp|gif|svg)/.test(req.src);
    const url = await upload(await renderCropArea(img, crop, aspect, 2400, 2400, transparent));
    if (editor.getBlock(req.blockId)) editor.updateBlock(req.blockId, { props: { url } });
    onClose();
  };
  return <ImageCropDialog src={req.src} formats={FORMATS} title={t('Recadrer l’image')} onCancel={onClose} onDone={finish} />;
}
