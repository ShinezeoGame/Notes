// Largeur des colonnes : glisser la séparation entre deux colonnes (souris ou stylet ; au doigt, menu ⠿). Pendant le glisser, la
// nouvelle largeur n'est qu'un décor local ; elle est enregistrée (et partagée) au relâchement, en une seule étape.
// Les classes bn-column-list-hovered et bn-column-resize-border sont mises en forme par le CSS de BlockNote.
import type { Node as PMNode } from 'prosemirror-model';
import { Plugin, PluginKey, type Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, type EditorView } from 'prosemirror-view';
import { columnWidth } from './util';

/** Rangée survolée et, près d'une séparation, la colonne à sa gauche (positions dans le document). */
type Hover = { list: number; left: number | null };
type Drag = { list: number; left: number; right: number; leftWidth: number; rightWidth: number };
type ResizeState = { hover: Hover | null; drag: Drag | null };

const resizeKey = new PluginKey<ResizeState>('nbColumnsResize');
/** Distance au trait de séparation (px) à laquelle on peut le saisir. */
const EDGE = 7;
/** Largeur minimale du contenu d'une colonne pendant le réglage (px). */
const MIN_CONTENT = 60;
/** Classe du conteneur de l'éditeur pendant le survol d'une séparation (menu ⠿ masqué, voir styles.css). */
const HOVER_CLASS = 'nb-col-resize-hover';

const EMPTY: ResizeState = { hover: null, drag: null };
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));
const round = (v: number) => Math.round(v * 1000) / 1000;

function mapPos(tr: Transaction, pos: number): number | null {
  const r = tr.mapping.mapResult(pos);
  return r.deleted ? null : r.pos;
}

function mapState(tr: Transaction, s: ResizeState): ResizeState {
  let hover: Hover | null = null;
  if (s.hover) {
    const list = mapPos(tr, s.hover.list);
    const left = s.hover.left == null ? null : mapPos(tr, s.hover.left);
    if (list != null) hover = { list, left };
  }
  let drag: Drag | null = null;
  if (s.drag) {
    const list = mapPos(tr, s.drag.list);
    const left = mapPos(tr, s.drag.left);
    const right = mapPos(tr, s.drag.right);
    if (list != null && left != null && right != null) drag = { ...s.drag, list, left, right };
  }
  return { hover, drag };
}

const nodeAt = (doc: PMNode, pos: number, type: string) => {
  const node = doc.nodeAt(pos);
  return node && node.type.name === type ? node : null;
};

class ResizeView {
  private readonly abort = new AbortController();
  private view: EditorView;
  /** Glisser en cours : mesures prises au début. */
  private drag: { startX: number; leftPx: number; totalPx: number; totalWidth: number } | null = null;

  constructor(view: EditorView) {
    this.view = view;
    // Sur la fenêtre, en phase de capture : un appui sur une séparation est pour nous seuls (ni l'éditeur, ni la barre
    // de mise en forme de BlockNote ne le voient).
    const win = view.dom.ownerDocument.defaultView ?? window;
    const opts = { signal: this.abort.signal, capture: true };
    win.addEventListener('pointermove', this.onMove, opts);
    win.addEventListener('pointerdown', this.onDown, opts);
    win.addEventListener('pointerup', this.onUp, opts);
    win.addEventListener('pointercancel', this.onUp, opts);
  }

  /** À chaque mise à jour de l'éditeur : classe du conteneur alignée sur l'état (rangée supprimée entre-temps…). */
  update(view: EditorView) {
    this.view = view;
    const s = this.state();
    this.container()?.classList.toggle(HOVER_CLASS, s.hover?.left != null || s.drag != null);
  }

  destroy() {
    this.abort.abort();
    this.container()?.classList.remove(HOVER_CLASS);
  }

  private container() {
    return this.view.dom.closest('.bn-container') ?? this.view.dom.parentElement;
  }

  private state(): ResizeState {
    return resizeKey.getState(this.view.state) ?? EMPTY;
  }

  private set(next: ResizeState) {
    if (JSON.stringify(this.state()) === JSON.stringify(next)) return;
    this.view.dispatch(this.view.state.tr.setMeta(resizeKey, next));
  }

  /** Rangée et séparation sous le pointeur (le menu ⠿ peut recouvrir la séparation : on raisonne en coordonnées). */
  private hit(x: number, y: number): { hover: Hover; columns: HTMLElement[]; index: number } | null {
    try {
      return this.hitAt(x, y);
    } catch {
      return null; // élément en cours de remplacement par l'éditeur
    }
  }

  private hitAt(x: number, y: number): { hover: Hover; columns: HTMLElement[]; index: number } | null {
    for (const el of this.view.dom.querySelectorAll<HTMLElement>('.bn-block-column-list')) {
      const box = el.getBoundingClientRect();
      if (x < box.left - EDGE || x > box.right + EDGE || y < box.top || y > box.bottom) continue;
      const listPos = this.view.posAtDOM(el, 0) - 1;
      const list = nodeAt(this.view.state.doc, listPos, 'columnList');
      if (!list) return null;
      const columns = Array.from(el.children).filter((c): c is HTMLElement => c instanceof HTMLElement && c.classList.contains('bn-block-column'));
      let index = -1;
      for (let i = 0; i + 1 < columns.length && i + 1 < list.childCount; i++) {
        // Trait de séparation dessiné juste à droite de la colonne de gauche (CSS de BlockNote : 4 px).
        if (Math.abs(x - (columns[i].getBoundingClientRect().right + 2)) <= EDGE) index = i;
      }
      let left: number | null = null;
      if (index >= 0) {
        let offset = 0;
        for (let i = 0; i < index; i++) offset += list.child(i).nodeSize;
        left = listPos + 1 + offset;
      }
      return { hover: { list: listPos, left }, columns, index };
    }
    return null;
  }

  private readonly onMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    const s = this.state();
    if (this.drag && s.drag) {
      const { startX, leftPx, totalPx, totalWidth } = this.drag;
      const px = clamp(leftPx + e.clientX - startX, MIN_CONTENT, totalPx - MIN_CONTENT);
      const leftWidth = round((totalWidth * px) / totalPx);
      this.set({ ...s, drag: { ...s.drag, leftWidth, rightWidth: round(totalWidth - leftWidth) } });
      return;
    }
    if (!this.view.editable || e.buttons) {
      this.set(EMPTY);
      return;
    }
    const hit = this.hit(e.clientX, e.clientY);
    this.set(hit ? { hover: hit.hover, drag: null } : EMPTY);
  };

  private readonly onDown = (e: PointerEvent) => {
    if (e.button !== 0 || e.pointerType === 'touch' || !this.view.editable) return;
    const hit = this.hit(e.clientX, e.clientY);
    if (!hit || hit.index < 0 || hit.hover.left == null) return;
    const doc = this.view.state.doc;
    const leftNode = nodeAt(doc, hit.hover.left, 'column');
    const rightPos = hit.hover.left + (leftNode?.nodeSize ?? 0);
    const rightNode = nodeAt(doc, rightPos, 'column');
    if (!leftNode || !rightNode) return;
    e.preventDefault();
    e.stopPropagation();
    const content = (el: HTMLElement) => {
      const cs = getComputedStyle(el);
      return el.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    };
    const leftPx = content(hit.columns[hit.index]);
    const rightPx = content(hit.columns[hit.index + 1]);
    const leftWidth = columnWidth(leftNode.attrs.width);
    const rightWidth = columnWidth(rightNode.attrs.width);
    this.drag = { startX: e.clientX, leftPx, totalPx: Math.max(1, leftPx + rightPx), totalWidth: leftWidth + rightWidth };
    this.set({ hover: hit.hover, drag: { list: hit.hover.list, left: hit.hover.left, right: rightPos, leftWidth, rightWidth } });
  };

  private readonly onUp = (e: PointerEvent) => {
    if (!this.drag) return;
    e.preventDefault();
    e.stopPropagation();
    this.drag = null;
    const s = this.state();
    const tr = this.view.state.tr.setMeta(resizeKey, { hover: s.hover, drag: null });
    if (s.drag) {
      const left = nodeAt(tr.doc, s.drag.left, 'column');
      const right = nodeAt(tr.doc, s.drag.right, 'column');
      if (left && right && (columnWidth(left.attrs.width) !== s.drag.leftWidth || columnWidth(right.attrs.width) !== s.drag.rightWidth)) {
        tr.setNodeMarkup(s.drag.left, undefined, { ...left.attrs, width: s.drag.leftWidth });
        tr.setNodeMarkup(s.drag.right, undefined, { ...right.attrs, width: s.drag.rightWidth });
      }
    }
    this.view.dispatch(tr);
  };
}

/** Réglage de la largeur des colonnes à la souris. */
export function columnsResizePlugin() {
  return new Plugin<ResizeState>({
    key: resizeKey,
    state: {
      init: () => EMPTY,
      apply(tr, prev) {
        const next = tr.getMeta(resizeKey) as ResizeState | undefined;
        if (next) return next;
        if (!tr.docChanged || (!prev.hover && !prev.drag)) return prev;
        return mapState(tr, prev);
      },
    },
    props: {
      decorations(state) {
        const s = resizeKey.getState(state);
        const at = s?.drag ?? s?.hover;
        if (!s || !at) return null;
        const list = nodeAt(state.doc, at.list, 'columnList');
        if (!list) return null;
        const decos = [Decoration.node(at.list, at.list + list.nodeSize, { class: 'bn-column-list-hovered' })];
        const left = at.left == null ? null : nodeAt(state.doc, at.left, 'column');
        if (left && at.left != null) {
          decos.push(
            Decoration.node(at.left, at.left + left.nodeSize, {
              class: 'bn-column-resize-border',
              ...(s.drag ? { style: `flex-grow: ${s.drag.leftWidth}` } : {}),
            }),
          );
        }
        const right = s.drag ? nodeAt(state.doc, s.drag.right, 'column') : null;
        if (s.drag && right) decos.push(Decoration.node(s.drag.right, s.drag.right + right.nodeSize, { style: `flex-grow: ${s.drag.rightWidth}` }));
        return DecorationSet.create(state.doc, decos);
      },
    },
    view: (view) => new ResizeView(view),
  });
}
