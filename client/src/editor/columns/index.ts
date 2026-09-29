// Colonnes : blocs côte à côte. Voir nodes.ts (blocs), drop.ts (glisser à côté), resize.ts (largeurs).
import type { BlockNoteEditor } from '@blocknote/core';
import { columnWidth } from './util';

export { columnBlockSpecs } from './nodes';
export { columnsDropCursor } from './drop';
export { MAX_COLUMNS } from './util';

type AnyEditor = BlockNoteEditor<any, any, any>;
type LooseBlock = { id: string; type: string; props: Record<string, unknown>; content?: unknown; children: LooseBlock[] };

const isEmptyParagraph = (b: LooseBlock) =>
  b.type === 'paragraph' && (!Array.isArray(b.content) || b.content.length === 0) && b.children.length === 0;

/** Insère une rangée de `count` colonnes vides (menu « / ») et place le curseur dans la première. */
export function insertColumns(editor: AnyEditor, count: number) {
  const current = editor.getTextCursorPosition().block as LooseBlock;
  const row = {
    type: 'columnList',
    children: Array.from({ length: count }, () => ({ type: 'column', props: { width: 1 }, children: [{ type: 'paragraph' }] })),
  };
  // Pas de rangée dans une colonne : la nouvelle se place après la rangée qui contient le curseur.
  const parent = editor.getParentBlock(current.id) as LooseBlock | undefined;
  const list = parent?.type === 'column' ? (editor.getParentBlock(parent.id) as LooseBlock | undefined) : undefined;
  const inserted = (
    list
      ? editor.insertBlocks([row as never], list.id, 'after')
      : isEmptyParagraph(current)
        ? editor.replaceBlocks([current.id], [row as never]).insertedBlocks
        : editor.insertBlocks([row as never], current.id, 'after')
  ) as LooseBlock[];
  const first = inserted[0]?.children[0]?.children[0];
  if (first) editor.setTextCursorPosition(first.id, 'start');
}

/** Colonne qui contient ce bloc, avec sa rangée. */
export function columnOf(editor: AnyEditor, blockId: string): { column: LooseBlock; list: LooseBlock } | null {
  const column = editor.getParentBlock(blockId) as LooseBlock | undefined;
  if (column?.type !== 'column') return null;
  const list = editor.getParentBlock(column.id) as LooseBlock | undefined;
  return list?.type === 'columnList' ? { column, list } : null;
}

/** Part de la rangée occupée par la colonne (0 à 1). */
export function columnShare(list: LooseBlock, columnId: string): number {
  const total = list.children.reduce((sum, c) => sum + columnWidth(c.props.width), 0);
  const col = list.children.find((c) => c.id === columnId);
  return col && total > 0 ? columnWidth(col.props.width) / total : 0;
}

/**
 * Donne à la colonne la part `share` de la rangée (les autres gardent leurs proportions) ; `null` : parts égales.
 */
export function setColumnShare(editor: AnyEditor, columnId: string, share: number | null) {
  const list = editor.getParentBlock(columnId) as LooseBlock | undefined;
  if (list?.type !== 'columnList') return;
  editor.transact(() => {
    if (share == null) {
      for (const c of list.children) editor.updateBlock(c.id, { props: { width: 1 } } as never);
      return;
    }
    const others = list.children.filter((c) => c.id !== columnId).reduce((sum, c) => sum + columnWidth(c.props.width), 0);
    editor.updateBlock(columnId, { props: { width: columnWidth((share * others) / (1 - share)) } } as never);
  });
}
