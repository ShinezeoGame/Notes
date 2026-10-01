// Taille du texte : style de texte (marque) applicable à une sélection ou à tout un bloc.
import { createReactStyleSpec } from '@blocknote/react';
import type { BlockNoteEditor } from '@blocknote/core';
import { t } from '../../lib/i18n';

export const TEXT_SIZES = [
  { value: 'small', label: t('Petit'), scale: 0.85, iconSize: 12 },
  { value: '', label: t('Normal'), scale: 1, iconSize: 14 },
  { value: 'large', label: t('Grand'), scale: 1.25, iconSize: 16 },
  { value: 'xlarge', label: t('Très grand'), scale: 1.5, iconSize: 18 },
  { value: 'huge', label: t('Énorme'), scale: 2, iconSize: 20 },
] as const;

export type TextSizeValue = (typeof TEXT_SIZES)[number]['value'];

const VALID = new Set<string>(TEXT_SIZES.map((t) => t.value).filter(Boolean));

export const TextSizeStyle = createReactStyleSpec(
  { type: 'textSize', propSchema: 'string' },
  {
    render: ({ value, contentRef }) => (
      <span className={VALID.has(value ?? '') ? `nb-ts nb-ts--${value}` : 'nb-ts'} data-text-size={value} ref={contentRef} />
    ),
  },
);

type LooseStyled = { type: string; text?: string; styles?: Record<string, unknown>; content?: LooseStyled[] };
type LooseBlock = { id: string; type: string; content?: unknown };

/** Blocs dont le texte peut changer de taille (texte riche, hors code et tableaux). */
export function supportsTextSize(block: LooseBlock): boolean {
  return Array.isArray(block.content) && block.type !== 'codeBlock';
}

function eachText(content: LooseStyled[], fn: (t: LooseStyled) => void) {
  for (const ic of content) {
    if (ic.type === 'text') fn(ic);
    else if (ic.type === 'link' && Array.isArray(ic.content)) ic.content.forEach(fn);
  }
}

/** Taille commune à tout le texte du bloc, '' si normale, null si mélangée. */
export function blockTextSize(block: LooseBlock): string | null {
  if (!Array.isArray(block.content)) return null;
  const sizes = new Set<string>();
  eachText(block.content as LooseStyled[], (t) => sizes.add(String(t.styles?.textSize ?? '')));
  if (sizes.size === 0) return '';
  return sizes.size === 1 ? [...sizes][0] : null;
}

/** Applique une taille à tout le texte d'un bloc (bloc vide : la taille s'applique à la saisie suivante). */
export function applyBlockTextSize(editor: BlockNoteEditor<any, any, any>, blockRef: LooseBlock, size: string) {
  // Relit le bloc : l'objet transmis par un menu peut dater d'avant les dernières frappes.
  const block = (editor.getBlock(blockRef.id) as LooseBlock | undefined) ?? blockRef;
  if (!Array.isArray(block.content)) return;
  const content = block.content as LooseStyled[];
  const hasText = content.some((ic) => ic.type === 'text' || ic.type === 'link');
  if (!hasText) {
    editor.setTextCursorPosition(block.id, 'end');
    editor.focus();
    if (size) editor.addStyles({ textSize: size });
    else editor.removeStyles({ textSize: '' });
    return;
  }
  const withSize = (t: LooseStyled): LooseStyled => {
    const styles = { ...(t.styles ?? {}) };
    if (size) styles.textSize = size;
    else delete styles.textSize;
    return { ...t, styles };
  };
  const next = content.map((ic) =>
    ic.type === 'text' ? withSize(ic) : ic.type === 'link' && Array.isArray(ic.content) ? { ...ic, content: ic.content.map(withSize) } : ic,
  );
  editor.updateBlock(block.id, { content: next as never });
}
