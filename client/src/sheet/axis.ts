// Tableur : positions des lignes ou des colonnes de la grille (taille par défaut, quelques tailles personnalisées).

export class Axis {
  readonly count: number;
  readonly def: number;
  private keys: number[];
  private sizes: Map<number, number>;
  /** cum[i] : écart cumulé à la taille par défaut jusqu'à keys[i] compris. */
  private cum: number[];

  constructor(def: number, custom: Record<string, number> | undefined, count: number) {
    this.def = def;
    this.count = count;
    this.sizes = new Map();
    for (const [k, v] of Object.entries(custom ?? {})) {
      const i = Number(k);
      if (Number.isInteger(i) && i >= 0 && i < count && v > 0) this.sizes.set(i, v);
    }
    this.keys = [...this.sizes.keys()].sort((a, b) => a - b);
    let acc = 0;
    this.cum = this.keys.map((k) => (acc += this.sizes.get(k)! - def));
  }

  size(i: number): number {
    return this.sizes.get(i) ?? this.def;
  }

  /** Nombre de tailles personnalisées avant `i`. */
  private before(i: number): number {
    let lo = 0;
    let hi = this.keys.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.keys[mid] < i) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Début (px) de la ligne ou colonne `i`. */
  pos(i: number): number {
    const k = this.before(i);
    return i * this.def + (k ? this.cum[k - 1] : 0);
  }

  total(): number {
    return this.pos(this.count);
  }

  /** Ligne ou colonne à la position `px`. */
  indexAt(px: number): number {
    if (px <= 0) return 0;
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.pos(mid) <= px) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  }
}
