// Icônes des widgets Android (écran d'accueil du téléphone) : celles de l'application (client/src/icons/registry.ts)
// converties en dessins vectoriels Android, couleur du trait selon le thème du téléphone (@color/widget_icon).
// À relancer après un changement d'icône : node --experimental-strip-types scripts/android-widget-icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { ICONS } = await import(path.join(ROOT, 'client/src/icons/registry.ts'));
const OUT = path.join(ROOT, 'android/app/src/main/res/drawable');

/** Icône de l'application → nom de la ressource Android (ic_w_…). */
const WANTED = {
  filePlus: 'new_page',
  note: 'notes',
  calendar: 'agenda',
  papers: 'papers',
  camera: 'camera',
  filePdf: 'pdf',
  bulb: 'home',
  cctv: 'cameras',
  server: 'homelab',
  dashboard: 'dashboard',
  checkSquare: 'tasks',
  plus: 'add',
  refresh: 'refresh',
  power: 'power',
  monitor: 'computer',
};

const n = (v) => Number(v.toFixed(3)).toString();
const points = (s) => s.trim().split(/[\s,]+/).map(Number);

/** Forme simple → tracé (les dessins vectoriels Android n'ont que des tracés). */
function pathData(s) {
  switch (s.t) {
    case 'path':
      return s.d;
    case 'line':
      return `M${n(s.x1)},${n(s.y1)}L${n(s.x2)},${n(s.y2)}`;
    case 'polyline':
    case 'polygon': {
      const p = points(s.points);
      let d = `M${n(p[0])},${n(p[1])}`;
      for (let i = 2; i < p.length; i += 2) d += `L${n(p[i])},${n(p[i + 1])}`;
      return s.t === 'polygon' ? `${d}Z` : d;
    }
    case 'circle':
      return `M${n(s.cx - s.r)},${n(s.cy)}a${n(s.r)},${n(s.r)} 0,1 0,${n(2 * s.r)},0a${n(s.r)},${n(s.r)} 0,1 0,${n(-2 * s.r)},0Z`;
    case 'ellipse':
      return `M${n(s.cx - s.rx)},${n(s.cy)}a${n(s.rx)},${n(s.ry)} 0,1 0,${n(2 * s.rx)},0a${n(s.rx)},${n(s.ry)} 0,1 0,${n(-2 * s.rx)},0Z`;
    case 'rect': {
      const { x, y, w, h } = s;
      const r = Math.min(s.rx || 0, w / 2, h / 2);
      if (!r) return `M${n(x)},${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
      return (
        `M${n(x + r)},${n(y)}H${n(x + w - r)}A${n(r)},${n(r)} 0,0 1,${n(x + w)},${n(y + r)}V${n(y + h - r)}` +
        `A${n(r)},${n(r)} 0,0 1,${n(x + w - r)},${n(y + h)}H${n(x + r)}A${n(r)},${n(r)} 0,0 1,${n(x)},${n(y + h - r)}` +
        `V${n(y + r)}A${n(r)},${n(r)} 0,0 1,${n(x + r)},${n(y)}Z`
      );
    }
    default:
      throw new Error(`forme inconnue : ${s.t}`);
  }
}

for (const [icon, name] of Object.entries(WANTED)) {
  const shapes = ICONS[icon];
  if (!shapes) throw new Error(`icône absente : ${icon}`);
  const paths = shapes
    .map((s) =>
      s.fill
        ? `    <path\n        android:fillColor="@color/widget_icon"\n        android:pathData="${pathData(s)}" />`
        : `    <path\n        android:fillColor="#00000000"\n        android:strokeColor="@color/widget_icon"\n        android:strokeWidth="1.8"\n        android:strokeLineCap="round"\n        android:strokeLineJoin="round"\n        android:pathData="${pathData(s)}" />`,
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- Généré par scripts/android-widget-icons.mjs (icône « ${icon} » de l'application) : ne pas modifier à la main. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="24dp"
    android:height="24dp"
    android:viewportWidth="24"
    android:viewportHeight="24">
${paths}
</vector>
`;
  fs.writeFileSync(path.join(OUT, `ic_w_${name}.xml`), xml);
}
// Raccourcis du lanceur (appui long sur l'icône d'Ostal, ou posés sur l'écran d'accueil) : dessin blanc sur un rond
// violet, comme le logo.
const LAUNCHER = ['new_page', 'notes', 'agenda', 'papers', 'camera', 'pdf', 'home', 'cameras', 'homelab', 'dashboard', 'tasks', 'computer'];
for (const [icon, name] of Object.entries(WANTED)) {
  if (!LAUNCHER.includes(name)) continue;
  const paths = ICONS[icon]
    .map((s) =>
      s.fill
        ? `        <path\n            android:fillColor="#FFFFFFFF"\n            android:pathData="${pathData(s)}" />`
        : `        <path\n            android:fillColor="#00000000"\n            android:strokeColor="#FFFFFFFF"\n            android:strokeWidth="1.8"\n            android:strokeLineCap="round"\n            android:strokeLineJoin="round"\n            android:pathData="${pathData(s)}" />`,
    )
    .join('\n');
  const xml = `<?xml version="1.0" encoding="utf-8"?>
<!-- Généré par scripts/android-widget-icons.mjs (raccourci du lanceur, icône « ${icon} ») : ne pas modifier à la main. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="48dp"
    android:height="48dp"
    android:viewportWidth="48"
    android:viewportHeight="48">
    <path
        android:fillColor="#FF6C5CFF"
        android:pathData="M0,24a24,24 0,1 0,48,0a24,24 0,1 0,-48,0Z" />
    <group
        android:translateX="12"
        android:translateY="12">
${paths}
    </group>
</vector>
`;
  fs.writeFileSync(path.join(OUT, `ic_sc_${name}.xml`), xml);
}
console.log(Object.keys(WANTED).length, 'icônes de widgets,', LAUNCHER.length, 'icônes de raccourcis');
