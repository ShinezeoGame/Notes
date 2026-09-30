// Réordonner les éléments d'une grille ou d'une liste par glisser-déposer (appareils de la Maison, caméras, modules du
// homelab, raccourcis, tâches…). Souris : on glisse l'élément (au-delà de 6 px ; un simple clic garde son effet). Écran
// tactile : appui long, puis glisser (un glissement rapide fait défiler la page, comme d'habitude). Les autres éléments
// s'écartent en douceur ; le nouvel ordre n'est transmis qu'au relâchement. Échap annule.
import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

/** À répandre sur l'élément racine de chaque entrée (enfant direct de la grille ou de la liste). */
export type SortItemProps = {
  ref?: (el: HTMLElement | null) => void;
  'data-sort-id'?: string;
  onPointerDown?: (e: ReactPointerEvent<HTMLElement>) => void;
  className: string;
};

/** Appuyer ici ne déplace jamais l'élément : champs de saisie, curseurs, vidéo avec commandes… */
const IGNORE = 'input, textarea, select, [contenteditable="true"], [data-sort-ignore], video[controls]';
const MOUSE_THRESHOLD = 6;
const TOUCH_DELAY = 400;
const TOUCH_TOLERANCE = 8;
/** Zone près du haut et du bas de la zone qui défile où la page défile toute seule pendant le glisser (px). */
const EDGE = 56;
const EASE = 'cubic-bezier(.2, .7, .3, 1)';

type Point = { x: number; y: number };

type Drag = {
  id: string;
  pointerId: number;
  touch: boolean;
  start: Point;
  client: Point;
  active: boolean;
  timer?: ReturnType<typeof setTimeout>;
  container: HTMLElement;
  /** Point saisi dans l'élément, par rapport au coin de sa place. */
  grab: Point;
  scroller: HTMLElement | null;
  raf: number;
  /** Ordre précédent et heure du dernier changement : évite les allers-retours entre deux places. */
  prevKey: string;
  movedAt: number;
  off: () => void;
};

const sameOrder = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Ordre en cours de glisser, privé des éléments disparus entre-temps et complété de ceux apparus. */
function reconcile(preview: readonly string[], ids: readonly string[]): string[] {
  const known = new Set(ids);
  const kept = preview.filter((id) => known.has(id));
  const seen = new Set(kept);
  return [...kept, ...ids.filter((id) => !seen.has(id))];
}

/** Place de l'élément dans son conteneur, sans les déplacements animés en cours. */
const slotOf = (el: HTMLElement) => ({ x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight });

/** Point de l'écran dans le repère du contenu du conteneur (défilement du conteneur compris). */
function local(container: HTMLElement, p: Point): Point {
  const r = container.getBoundingClientRect();
  return { x: p.x - r.left - container.clientLeft + container.scrollLeft, y: p.y - r.top - container.clientTop + container.scrollTop };
}

function scrollParent(el: HTMLElement): HTMLElement | null {
  for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
    if (/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 1) return p;
  }
  return null;
}

/** Le clic qui suit un glisser ne doit pas allumer une lampe ou ouvrir une application. */
function swallowNextClick() {
  const stop = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
  };
  window.addEventListener('click', stop, { capture: true, once: true });
  setTimeout(() => window.removeEventListener('click', stop, { capture: true }), 80);
}

function settle(el: HTMLElement) {
  const done = () => {
    el.style.transition = '';
    el.removeEventListener('transitionend', done);
  };
  el.addEventListener('transitionend', done);
  setTimeout(done, 400);
}

/**
 * Glisser-déposer dans une liste d'identifiants. Rend l'ordre à afficher (l'aperçu pendant le glisser) et les propriétés
 * de chaque élément. `onReorder` reçoit tous les identifiants dans leur nouvel ordre.
 */
export function useSortable(ids: readonly string[], onReorder: (ids: string[]) => void, enabled = true) {
  const [preview, setPreview] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const order = preview ? reconcile(preview, ids) : ids;
  const on = enabled && ids.length > 1;

  const orderRef = useRef(order);
  orderRef.current = order;
  const idsRef = useRef(ids);
  idsRef.current = ids;
  const reorderRef = useRef(onReorder);
  reorderRef.current = onReorder;
  const els = useRef(new Map<string, HTMLElement>());
  const refFns = useRef(new Map<string, (el: HTMLElement | null) => void>());
  const drag = useRef<Drag | null>(null);
  /** Positions à l'écran avant un changement d'ordre : les éléments glissent de là vers leur nouvelle place. */
  const flipFrom = useRef<Map<string, Point> | null>(null);

  // Après le dépôt : l'aperçu cède la place à l'ordre enregistré (ou, s'il n'a pas été repris, à l'ordre d'origine).
  useEffect(() => {
    if (!preview || dragging) return;
    if (sameOrder(reconcile(preview, ids), ids)) {
      setPreview(null);
      return;
    }
    const t = setTimeout(() => setPreview(null), 1500);
    return () => clearTimeout(t);
  }, [preview, dragging, ids]);

  // Élément glissé retiré (appareil supprimé ailleurs…) : le glisser s'arrête.
  useEffect(() => {
    const d = drag.current;
    if (d && !ids.includes(d.id)) finish(false);
  });

  useEffect(
    () => () => {
      const d = drag.current;
      if (!d) return;
      d.off();
      drag.current = null;
      if (d.active) document.documentElement.classList.remove('sort-active');
    },
    [],
  );

  const place = (d: Drag) => {
    const el = els.current.get(d.id);
    if (!el) return;
    const p = local(d.container, d.client);
    const s = slotOf(el);
    el.style.transform = `translate(${p.x - d.grab.x - s.x}px, ${p.y - d.grab.y - s.y}px)`;
  };

  const snapshot = (list: readonly string[]) => {
    const out = new Map<string, Point>();
    for (const id of list) {
      const el = els.current.get(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      out.set(id, { x: r.left, y: r.top });
    }
    return out;
  };

  const hitTest = (d: Drag) => {
    const cur = orderRef.current;
    const p = local(d.container, d.client);
    const others = cur.filter((id) => id !== d.id);
    let target = -1;
    for (const id of others) {
      const el = els.current.get(id);
      if (!el) continue;
      const s = slotOf(el);
      if (p.x >= s.x && p.x < s.x + s.w && p.y >= s.y && p.y < s.y + s.h) {
        target = cur.indexOf(id);
        break;
      }
    }
    if (target < 0) {
      // Après le dernier élément (au bout de la dernière rangée ou en dessous) : à la fin.
      const last = els.current.get(others[others.length - 1]);
      if (!last) return;
      const s = slotOf(last);
      if (p.y > s.y + s.h || (p.y >= s.y && p.x > s.x + s.w)) target = cur.length - 1;
      else return;
    }
    if (cur.indexOf(d.id) === target) return;
    const next = [...others];
    next.splice(target, 0, d.id);
    const key = next.join('\n');
    const now = performance.now();
    if (key === d.prevKey && now - d.movedAt < 300) return;
    flipFrom.current = snapshot(others);
    d.prevKey = cur.join('\n');
    d.movedAt = now;
    setPreview(next);
  };

  const edgeSpeed = (d: Drag) => {
    const r = d.scroller?.getBoundingClientRect();
    const top = r ? r.top : 0;
    const bottom = r ? r.bottom : window.innerHeight;
    const y = d.client.y;
    if (y < top + EDGE) return -Math.ceil((top + EDGE - y) / 4);
    if (y > bottom - EDGE) return Math.ceil((y - (bottom - EDGE)) / 4);
    return 0;
  };

  const activate = (d: Drag) => {
    const el = els.current.get(d.id);
    const container = el?.parentElement;
    if (!el || !container) return finish(false);
    // Les places se mesurent par rapport au conteneur.
    if (getComputedStyle(container).position === 'static') container.style.position = 'relative';
    d.container = container;
    d.active = true;
    const p = local(container, d.start);
    const s = slotOf(el);
    d.grab = { x: p.x - s.x, y: p.y - s.y };
    d.scroller = scrollParent(container);
    el.style.transition = 'none';
    document.documentElement.classList.add('sort-active');
    window.getSelection()?.removeAllRanges();
    if (d.touch) navigator.vibrate?.(10);
    setDragging(d.id);
    setPreview([...orderRef.current]);
    place(d);
    const tick = () => {
      if (drag.current !== d) return;
      const speed = edgeSpeed(d);
      if (speed) {
        if (d.scroller) d.scroller.scrollTop += speed;
        else window.scrollBy(0, speed);
        place(d);
        hitTest(d);
      }
      d.raf = requestAnimationFrame(tick);
    };
    d.raf = requestAnimationFrame(tick);
  };

  function finish(commit: boolean) {
    const d = drag.current;
    if (!d) return;
    d.off();
    drag.current = null;
    if (!d.active) return;
    document.documentElement.classList.remove('sort-active');
    const el = els.current.get(d.id);
    const final = orderRef.current;
    const changed = !sameOrder(final, idsRef.current);
    setDragging(null);
    if (commit) swallowNextClick();
    if (!commit && changed) {
      // Annulé : chacun (l'élément glissé compris) retourne à sa place d'origine.
      flipFrom.current = snapshot(final);
      setPreview(null);
      return;
    }
    if (el) {
      el.style.transition = `transform 180ms ${EASE}`;
      el.style.transform = '';
      settle(el);
    }
    if (commit && changed) reorderRef.current([...final]);
    else setPreview(null);
  }

  // Nouvel ordre affiché : les autres éléments glissent vers leur nouvelle place, l'élément saisi reste sous le doigt.
  const orderKey = order.join('\n');
  useLayoutEffect(() => {
    const from = flipFrom.current;
    flipFrom.current = null;
    if (from) {
      for (const [id, pos] of from) {
        const el = els.current.get(id);
        if (!el) continue;
        el.style.transition = 'none';
        el.style.transform = '';
        const r = el.getBoundingClientRect();
        const dx = pos.x - r.left;
        const dy = pos.y - r.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) {
          el.style.transition = '';
          continue;
        }
        el.style.transform = `translate(${dx}px, ${dy}px)`;
        void el.offsetWidth; // position de départ appliquée avant l'animation
        el.style.transition = `transform 200ms ${EASE}`;
        el.style.transform = '';
        settle(el);
      }
    }
    const d = drag.current;
    if (d?.active) place(d);
  }, [orderKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const refFor = (id: string) => {
    let fn = refFns.current.get(id);
    if (!fn) {
      fn = (el: HTMLElement | null) => {
        if (el) els.current.set(id, el);
        else if (els.current.get(id)) els.current.delete(id);
      };
      refFns.current.set(id, fn);
    }
    return fn;
  };

  const downFor = (id: string) => (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const t = e.target as Element;
    // Liste imbriquée : c'est la plus proche du doigt qui répond.
    if (t.closest(IGNORE) || t.closest('[data-sort-id]') !== e.currentTarget) return;
    const d: Drag = {
      id,
      pointerId: e.pointerId,
      touch: e.pointerType !== 'mouse',
      start: { x: e.clientX, y: e.clientY },
      client: { x: e.clientX, y: e.clientY },
      active: false,
      container: e.currentTarget.parentElement as HTMLElement,
      grab: { x: 0, y: 0 },
      scroller: null,
      raf: 0,
      prevKey: '',
      movedAt: 0,
      off: () => {},
    };
    drag.current = d;
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== d.pointerId) return;
      d.client = { x: ev.clientX, y: ev.clientY };
      if (!d.active) {
        const dist = Math.hypot(ev.clientX - d.start.x, ev.clientY - d.start.y);
        if (d.touch) {
          if (dist > TOUCH_TOLERANCE) finish(false); // le doigt fait défiler la page
        } else if (dist > MOUSE_THRESHOLD) activate(d);
        return;
      }
      ev.preventDefault();
      place(d);
      hitTest(d);
    };
    const up = (ev: PointerEvent) => ev.pointerId === d.pointerId && finish(true);
    const cancel = (ev: PointerEvent) => ev.pointerId === d.pointerId && finish(false);
    const touchMove = (ev: TouchEvent) => d.active && ev.preventDefault();
    // Pas de menu (copier, ouvrir le lien…) à l'appui long.
    const menu = (ev: Event) => d.touch && ev.preventDefault();
    const key = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !d.active) return;
      ev.preventDefault();
      ev.stopPropagation();
      finish(false);
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('touchmove', touchMove, { passive: false });
    window.addEventListener('contextmenu', menu, true);
    window.addEventListener('keydown', key, true);
    d.off = () => {
      clearTimeout(d.timer);
      cancelAnimationFrame(d.raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('touchmove', touchMove);
      window.removeEventListener('contextmenu', menu, true);
      window.removeEventListener('keydown', key, true);
    };
    if (d.touch) d.timer = setTimeout(() => drag.current === d && !d.active && activate(d), TOUCH_DELAY);
  };

  const itemProps = (id: string): SortItemProps =>
    on
      ? { ref: refFor(id), 'data-sort-id': id, onPointerDown: downFor(id), className: dragging === id ? 'sort-item sort-item--dragging' : 'sort-item' }
      : { className: '' };

  return { order, dragging, itemProps };
}

/**
 * Réordonne un sous-ensemble (les éléments affichés) à l'intérieur de la liste complète : ils échangent leurs places,
 * les autres ne bougent pas. Les identifiants absents de `all` sont ignorés.
 */
export function reorderSubset(all: readonly string[], subset: readonly string[]): string[] {
  const inAll = new Set(all);
  const moved = subset.filter((id) => inAll.has(id));
  const set = new Set(moved);
  const slots: number[] = [];
  all.forEach((id, i) => set.has(id) && slots.push(i));
  const out = [...all];
  slots.forEach((slot, i) => (out[slot] = moved[i]));
  return out;
}

/** Trie selon un ordre enregistré ; les éléments qui n'y figurent pas suivent, dans l'ordre fourni. */
export function sortByOrder<T>(list: readonly T[], order: readonly string[], key: (item: T) => string): T[] {
  const rank = new Map(order.map((id, i) => [id, i]));
  return list
    .map((item, i) => ({ item, i, r: rank.get(key(item)) }))
    .sort((a, b) => (a.r ?? Infinity) - (b.r ?? Infinity) || a.i - b.i)
    .map((x) => x.item);
}

/** Même opération sur des objets identifiés (caméras, modules du homelab, groupes…). */
export function reorderItems<T extends { id: string }>(list: readonly T[], shown: readonly string[]): T[] {
  const byId = new Map(list.map((x) => [x.id, x]));
  return reorderSubset(
    list.map((x) => x.id),
    shown,
  ).map((id) => byId.get(id)!);
}
