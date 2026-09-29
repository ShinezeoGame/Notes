// Glisser un bloc (poignée ⠿) contre le bord gauche ou droit d'un autre bloc : les deux se placent côte à côte,
// dans une nouvelle rangée de colonnes. Contre le bord d'une colonne existante : une colonne de plus.
// BlockNote affiche la barre verticale de dépôt (hook computeDropPosition) ; le dépôt lui-même est fait ici.
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, Selection, type EditorState, type Transaction } from 'prosemirror-state';
import { Mapping } from 'prosemirror-transform';
import type { EditorView } from 'prosemirror-view';
import { fixColumnList, isEmptyColumn } from '@blocknote/core';
import type { DropCursorHooks, DropCursorOptions } from '@blocknote/core/extensions';
import { MAX_COLUMNS } from './util';

type DropPosition = NonNullable<ReturnType<NonNullable<DropCursorHooks['computeDropPosition']>>>;

type Side = 'left' | 'right';

/** Dépôt à côté d'un bloc (hors colonnes) ou d'une colonne. */
export type SideDrop = { side: Side; kind: 'block' | 'column'; pos: number; node: PMNode };

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

/** Blocs saisis par la poignée ⠿ (sélection posée par BlockNote au début du glisser) : blocs frères consécutifs. */
function draggedBlocks(state: EditorState): { from: number; to: number } | null {
  const { from, to } = state.selection;
  if (from >= to) return null;
  const $from = state.doc.resolve(from);
  const $to = state.doc.resolve(to);
  if (!$from.sameParent($to)) return null;
  const parent = $from.parent;
  if (parent.type.name !== 'blockGroup' && parent.type.name !== 'column') return null;
  const first = $from.index();
  const end = $to.index();
  if (end <= first || from !== $from.posAtIndex(first) || to !== $to.posAtIndex(end)) return null;
  for (let i = first; i < end; i++) if (parent.child(i).type.name !== 'blockContainer') return null;
  return { from, to };
}

/** Colonne sous le pointeur, sinon bloc de premier niveau sous le pointeur. */
function targetAt(doc: PMNode, pos: number): Omit<SideDrop, 'side'> | null {
  const $pos = doc.resolve(pos);
  const chain: { pos: number; node: PMNode }[] = [];
  for (let d = 1; d <= $pos.depth; d++) chain.push({ pos: $pos.before(d), node: $pos.node(d) });
  if ($pos.nodeAfter) chain.push({ pos, node: $pos.nodeAfter });
  const column = chain.find((c) => c.node.type.name === 'column');
  if (column) return { kind: 'column', ...column };
  const top = chain[1];
  return top && top.node.type.name === 'blockContainer' ? { kind: 'block', ...top } : null;
}

/**
 * Dépôt « à côté » au point (x, y), ou null (dépôt ordinaire, entre deux blocs). La marge de gauche, où l'on
 * glisse les blocs pour les réordonner, n'en fait pas partie : il faut viser le bord du bloc lui-même.
 */
export function sideDropAt(view: EditorView, x: number, y: number): SideDrop | null {
  if (!view.editable) return null;
  const dragged = draggedBlocks(view.state);
  const root = view.dom.firstElementChild as HTMLElement | null;
  if (!dragged || !root) return null;
  const box = root.getBoundingClientRect();
  if (y < box.top || y > box.bottom) return null;
  const found = view.posAtCoords({ left: clamp(x, box.left + 1, box.right - 1), top: y });
  if (!found) return null;
  const doc = view.state.doc;
  const target = targetAt(doc, found.inside >= 0 ? found.inside : found.pos);
  if (!target) return null;
  const dom = view.nodeDOM(target.pos);
  if (!(dom instanceof HTMLElement)) return null;
  const rect = dom.getBoundingClientRect();
  if (y < rect.top || y > rect.bottom) return null;

  const $target = doc.resolve(target.pos);
  const firstColumn = target.kind === 'column' && $target.index() === 0;
  const leftZone = target.kind === 'column' ? clamp(rect.width * 0.15, 24, 80) : clamp(rect.width * 0.12, 24, 64);
  const rightZone = target.kind === 'column' ? clamp(rect.width * 0.15, 24, 80) : clamp(rect.width * 0.22, 48, 160);
  let side: Side;
  if (x >= rect.right - rightZone) side = 'right';
  else if (x <= rect.left + leftZone && (x >= rect.left || (target.kind === 'column' && !firstColumn))) side = 'left';
  else return null;

  const targetEnd = target.pos + target.node.nodeSize;
  if (target.kind === 'block') {
    // Pas à côté de soi-même (ni d'un bloc qui contient les blocs déplacés).
    if (dragged.from < targetEnd && dragged.to > target.pos) return null;
  } else {
    const list = $target.parent;
    const listPos = $target.before();
    // Blocs déplacés formant toute une colonne de cette rangée : elle disparaîtra, le nombre de colonnes ne change pas.
    let wholeColumn = -1;
    list.forEach((col, offset, index) => {
      const start = listPos + 1 + offset + 1;
      if (dragged.from === start && dragged.to === start + col.content.size) wholeColumn = index;
    });
    const index = $target.index();
    if (wholeColumn >= 0) {
      // À côté d'elle-même, ou du côté où elle est déjà : rien ne changerait.
      if (wholeColumn === index || wholeColumn === index + (side === 'right' ? 1 : -1)) return null;
    } else if (list.childCount >= MAX_COLUMNS) {
      return null;
    }
  }
  return { side, ...target };
}

/** Retire les blocs déplacés ; une colonne vidée disparaît (et la rangée, s'il ne reste qu'une colonne). */
function removeRange(tr: Transaction, from: number, to: number) {
  const $from = tr.doc.resolve(from);
  const parent = $from.parent;
  if (from !== $from.start() || to !== $from.end()) {
    tr.delete(from, to);
    return;
  }
  if (parent.type.name === 'column') {
    const columnPos = $from.before();
    const $column = tr.doc.resolve(columnPos);
    const list = $column.parent;
    if (list.childCount > 2) {
      tr.delete(columnPos, columnPos + parent.nodeSize);
    } else {
      const listPos = $column.before();
      tr.replaceWith(listPos, listPos + list.nodeSize, list.child($column.index() === 0 ? 1 : 0).content);
    }
    return;
  }
  // Tous les sous-blocs d'un bloc : le groupe qui les contenait disparaît.
  if ($from.depth > 1) tr.delete($from.before(), $from.after());
  else tr.delete(from, to);
}

/** Place les blocs saisis à côté de la cible, en une seule modification (annulable d'un coup). */
export function dropBeside(view: EditorView, drop: SideDrop): boolean {
  const { state } = view;
  const dragged = draggedBlocks(state);
  if (!dragged) return false;
  const { schema } = state;
  const moved = schema.nodes.column.create(null, state.doc.slice(dragged.from, dragged.to).content);
  const tr = state.tr;
  let movedStart: number;
  if (drop.kind === 'block') {
    const beside = schema.nodes.column.create(null, drop.node);
    const row = schema.nodes.columnList.create(null, drop.side === 'left' ? [moved, beside] : [beside, moved]);
    tr.replaceWith(drop.pos, drop.pos + drop.node.nodeSize, row);
    movedStart = drop.side === 'left' ? drop.pos + 2 : drop.pos + 1 + beside.nodeSize + 1;
  } else {
    const at = drop.side === 'left' ? drop.pos : drop.pos + drop.node.nodeSize;
    tr.insert(at, moved);
    movedStart = at + 1;
  }
  const before = tr.mapping.maps.length;
  removeRange(tr, tr.mapping.map(dragged.from), tr.mapping.map(dragged.to));
  movedStart = tr.mapping.slice(before).map(movedStart);
  tr.setSelection(Selection.near(tr.doc.resolve(movedStart)));
  tr.setMeta('uiEvent', 'drop');
  view.dispatch(tr);
  return true;
}

/** Barre verticale de dépôt contre le bord d'un bloc ou d'une colonne (option dropCursor de l'éditeur). */
export const columnsDropCursor: DropCursorOptions = {
  hooks: {
    computeDropPosition: ({ view, event, defaultPosition }): DropPosition | null => {
      if (!view.dragging) return defaultPosition;
      const drop = sideDropAt(view, event.clientX, event.clientY);
      if (!drop) return defaultPosition;
      return { pos: drop.pos, orientation: drop.side === 'left' ? 'block-vertical-left' : 'block-vertical-right' };
    },
  },
};

/** Colonne dont tous les blocs sont glissés (elle doit disparaître après le dépôt), ou null. */
function wholeColumnDragged(state: EditorState): number | null {
  const dragged = draggedBlocks(state);
  if (!dragged) return null;
  const $from = state.doc.resolve(dragged.from);
  return $from.parent.type.name === 'column' && dragged.from === $from.start() && dragged.to === $from.end() ? $from.before() : null;
}

/**
 * Fin d'un glisser par la poignée ⠿ sans « dragend » : quand le bloc déposé change de place dans les colonnes, la
 * poignée d'origine est redessinée et l'évènement ne remonte plus jusqu'à la page. BlockNote croirait alors le
 * glisser toujours en cours (barre de mise en forme figée). On le lui signale nous-mêmes.
 */
function watchDragEnd(view: EditorView, onLost: () => void) {
  const root = view.root;
  let blockDrag = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const onDragStart = (e: Event) => {
    blockDrag = e.target instanceof Element && !!e.target.closest('.bn-side-menu');
  };
  const onDrop = () => {
    if (!blockDrag) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      timer = undefined;
      blockDrag = false;
      root.dispatchEvent(new DragEvent('dragend', { bubbles: true }));
      onLost();
    }, 150);
  };
  const onDragEnd = (e: Event) => {
    if (!e.isTrusted) return;
    blockDrag = false;
    clearTimeout(timer);
    timer = undefined;
  };
  root.addEventListener('dragstart', onDragStart, true);
  root.addEventListener('drop', onDrop, true);
  root.addEventListener('dragend', onDragEnd, true);
  return {
    destroy() {
      clearTimeout(timer);
      root.removeEventListener('dragstart', onDragStart, true);
      root.removeEventListener('drop', onDrop, true);
      root.removeEventListener('dragend', onDragEnd, true);
    },
  };
}

/**
 * Dépôt d'un bloc glissé contre le bord d'un autre. Pour un dépôt ordinaire (entre deux blocs), ProseMirror fait
 * le travail ; si les blocs déplacés vidaient leur colonne, elle disparaît ensuite (et la rangée, s'il ne reste
 * qu'une colonne), comme après une suppression. `onLostDragEnd` : fin de glisser de BlockNote (voir watchDragEnd).
 */
export function columnsDropPlugin(onLostDragEnd: () => void = () => {}) {
  let emptied: number | null = null;
  return new Plugin({
    key: new PluginKey('nbColumnsDrop'),
    view: (view) => watchDragEnd(view, onLostDragEnd),
    props: {
      handleDrop(view, event, _slice, moved) {
        emptied = null;
        if (!moved) return false;
        const { clientX, clientY } = event as DragEvent;
        const drop = sideDropAt(view, clientX, clientY);
        if (drop) return dropBeside(view, drop);
        emptied = wholeColumnDragged(view.state);
        return false;
      },
    },
    appendTransaction(trs, _old, state) {
      const drop = trs.find((tr) => tr.getMeta('uiEvent') === 'drop' && tr.docChanged);
      if (emptied == null || !drop) return null;
      const mapping = new Mapping();
      for (const tr of trs) mapping.appendMapping(tr.mapping);
      // Côté gauche : ProseMirror remplace souvent la colonne vidée par une colonne vide neuve, au même endroit.
      const pos = mapping.map(emptied, -1);
      emptied = null;
      const column = state.doc.nodeAt(pos);
      if (!column || column.type.name !== 'column' || !isEmptyColumn(column)) return null;
      const tr = state.tr;
      fixColumnList(tr, state.doc.resolve(pos).before());
      return tr.docChanged ? tr : null;
    },
  });
}
