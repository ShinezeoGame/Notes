// Vérification des traductions de l'interface (npm run i18n:check, dans client/) :
// 1. chaque texte passé à t('…'), tx('…') ou tn(n, '…', '…') a sa traduction anglaise dans src/i18n/en.ts ;
// 2. aucun texte affiché ne reste en dur hors de t() (repérés : textes JSX, attributs affichés, chaînes en français).
// Options : --list (textes en dur trouvés), --keys (textes de t() sans traduction ; --json : en JSON), --unused (traductions
// inutilisées).
// Un texte volontairement laissé tel quel (nom propre, exemple…) porte le commentaire « i18n-ignore » sur sa ligne.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseAst } from 'rolldown/parseAst';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(root, 'src');
const args = new Set(process.argv.slice(2));

/** Fichiers sans texte d'interface (dictionnaire, outils techniques). */
const SKIP = [/[/\\]i18n[/\\]/, /\.d\.ts$/, /pdf-worker\.ts$/, /pdf-polyfills\.ts$/];
/** Attributs JSX affichés à l'écran (ou lus par les lecteurs d'écran). */
const SHOWN_ATTRS = new Set([
  'title',
  'placeholder',
  'aria-label',
  'alt',
  'label',
  'mainTooltip',
  'secondaryTooltip',
  'text',
  'aria-description',
  'aria-valuetext',
]);
/** Appels dont les textes ne sont pas affichés. */
const SILENT_CALLS =
  /^(console\.\w+|log|require|import|localStorage\.\w+|sessionStorage\.\w+|[\w.$[\]]+\.(getItem|setItem|removeItem|querySelector|querySelectorAll|closest|matches|getElementById|addEventListener|removeEventListener|dispatchEvent|getAttribute|setAttribute|hasAttribute|removeAttribute|startsWith|endsWith|includes|split|replace|replaceAll|match|test|indexOf|lastIndexOf|padStart|join|get|set|has|delete|getMap|getArray|getText|getXmlFragment|observe|postMessage|setProperty|getPropertyValue|toBlob|createElement|execCommand|send|on|off|emit|invoke)|new (URL|RegExp|Event|CustomEvent|Blob|File|URLSearchParams|Date|Intl\.\w+|Worker|BroadcastChannel|WebSocket)|fetch|t|tx|tn|tServer|matchMedia|useMediaQuery|RegExp|document\.\w+|window\.\w+)$/;

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|mts)$/.test(e.name) && !SKIP.some((r) => r.test(p))) files.push(p);
  }
})(SRC);

/** Noms propres (marques, logiciels) : identiques dans toutes les langues. */
const PROPER_NOUNS = new Set(
  'Melo Homelab PDF Windows Android Google Outlook Apple iCloud YouTube Vimeo Dailymotion Sonarr Radarr Lidarr Readarr Prowlarr Bazarr Jellyfin Emby Plex Jellyseerr Overseerr qBittorrent Transmission Pi-hole Portainer Nextcloud Immich Glances TrueNAS DuckDuckGo Qwant Bing Ecosia Open-Meteo Hikvision Dahua Reolink Tapo Foscam Amcrest Axis Ubiquiti Hue Sonos Chromecast'
    .split(' ')
    .concat([
      'AdGuard Home',
      'Home Assistant',
      'Uptime Kuma',
      'Proxmox VE',
      'Glances (API)',
      'Google Agenda',
      'Google Calendar',
      'Microsoft Outlook',
      'Apple iCloud',
    ]),
);
/** Propriétés dont tout le contenu est ignoré : mots-clés de recherche (menu « / »), jamais affichés. */
const SEARCH_KEYS = new Set(['aliases', 'keywords']);
/** Propriétés dont la valeur est une donnée (identifiant, type, valeur enregistrée), jamais affichée telle quelle. */
const DATA_KEYS = new Set([
  'id',
  'key',
  'type',
  'kind',
  'domain',
  'icon',
  'color',
  'category',
  'value',
  'mode',
  'unit',
  'format',
  'lang',
  'className',
  'variant',
  'role',
  'path',
  'url',
  'href',
  'src',
  'mime',
  'group',
  'section',
  'brand',
]);

/** Ressemble à du texte d'interface : des lettres, et une espace entre deux mots, un accent ou une ponctuation française. */
const looksLikeText = (s) =>
  /[A-Za-zÀ-ÿ]{2}/.test(s) &&
  (/[À-ÿŒœ’«»…]/.test(s) || /[A-Za-zà-ÿ]{2,}[ ,.:;!?]+[A-Za-zà-ÿ]{2,}/.test(s) || /^[A-ZÀ-Ý][a-zà-ÿ]{2,}[.!?…]?$/.test(s));
/** Adresses, chemins, noms de fichiers, sélecteurs, classes CSS, identifiants. */
const isTechnical = (s) =>
  /^\s*(linear-gradient|radial-gradient|conic-gradient|repeating-[a-z-]+|color-mix|rgba?|hsla?|url|var|calc|center|cubic-bezier)\b/.test(s) ||
  /^(https?:|data:|blob:|mailto:|tel:|#\/|\/|\.\/|\.\.\/)/.test(s) ||
  /^[\w.-]+\.(png|jpe?g|svg|webp|gif|pdf|ics|json|js|css|html|mp4|apk|exe)$/i.test(s) ||
  (/^[.#[]?[a-z][\w-]*([ .>:#[\]=,"'()-]+[\w-]*)*$/.test(s) &&
    !/[À-ÿ]/.test(s) &&
    !/\b(le|la|les|un|une|des|de|du|et|ou|à|en|pour|sur|avec|dans|par)\b/.test(s) &&
    // Plusieurs mots en minuscules sans tiret ni point (« actualisation impossible ») : du texte, pas des classes CSS.
    (!/ /.test(s.trim()) || /[-_.#[\]:=>0-9]/.test(s)));

const keys = new Map(); // texte -> premier emplacement
const hard = []; // textes en dur

for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(root, file);
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
  const lineOf = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
  const lines = src.split('\n');
  const ignored = (node) => /i18n-ignore/.test(lines[lineOf(node.start) - 1] ?? '');
  const where = (node) => `${rel}:${lineOf(node.start)}`;
  const report = (node, what) => !ignored(node) && hard.push(`${where(node)}  ${what}`);
  let ast;
  try {
    ast = parseAst(src, { lang: file.endsWith('x') ? 'tsx' : 'ts' });
  } catch (err) {
    hard.push(`${rel}  analyse impossible : ${err.message}`);
    continue;
  }

  const textOf = (n) => src.slice(n.start, n.end);
  const isString = (n) => n && n.type === 'Literal' && typeof n.value === 'string';
  const isFixedTemplate = (n) => n && n.type === 'TemplateLiteral' && n.expressions.length === 0;

  const visit = (node, parent) => {
    if (!node || typeof node.type !== 'string') return;
    switch (node.type) {
      case 'ImportDeclaration':
      case 'ExportAllDeclaration':
      case 'ImportExpression':
      case 'TSImportType':
      case 'TSLiteralType':
      case 'TSEnumDeclaration':
        return;
      case 'ExportNamedDeclaration':
        if (node.source) return;
        break;
      case 'Property':
        if (node.key && SEARCH_KEYS.has(node.key.name ?? node.key.value)) return;
        break;
      case 'CallExpression':
      case 'NewExpression': {
        const callee = textOf(node.callee);
        const name = node.type === 'NewExpression' ? `new ${callee}` : callee;
        // Clés de traduction : t('…'), tx('…', …) et tn(n, '…', '…').
        const keyArgs = node.type !== 'CallExpression' ? null : callee === 't' || callee === 'tx' ? [0] : callee === 'tn' ? [1, 2] : null;
        if (keyArgs) {
          node.arguments.forEach((arg, i) => {
            if (!keyArgs.includes(i)) return visit(arg, node);
            if (isString(arg) || isFixedTemplate(arg)) {
              const k = isString(arg) ? arg.value : arg.quasis[0].value.cooked;
              if (!keys.has(k)) keys.set(k, where(arg));
            } else report(arg, `${callee}() sans texte fixe : ${textOf(arg).slice(0, 60)}`);
          });
          return;
        }
        if (SILENT_CALLS.test(name)) return;
        break;
      }
      case 'JSXText': {
        const s = node.value.replace(/\s+/g, ' ').trim();
        if (/[A-Za-zÀ-ÿ]{2}/.test(s)) report(node, `JSX : ${s}`);
        return;
      }
      case 'JSXAttribute': {
        const name = textOf(node.name);
        const v = node.value;
        if (SHOWN_ATTRS.has(name) && isString(v) && /[A-Za-zÀ-ÿ]{2}/.test(v.value)) report(v, `${name}= : ${v.value}`);
        if (v && v.type === 'JSXExpressionContainer') {
          // Attribut non affiché (className, key, type…) : ses textes ne comptent pas.
          if (SHOWN_ATTRS.has(name)) visit(v.expression, v);
          else if (v.expression.type !== 'Literal' && v.expression.type !== 'TemplateLiteral') visit(v.expression, v);
        }
        return;
      }
      case 'Literal': {
        if (typeof node.value !== 'string') return;
        if (
          parent &&
          (parent.type === 'Property' || parent.type === 'PropertyDefinition' || parent.type === 'TSPropertySignature') &&
          parent.key === node
        )
          return;
        if (parent && parent.type === 'MemberExpression' && parent.property === node) return;
        if (parent && parent.type === 'BinaryExpression' && /[=!]==?|in/.test(parent.operator)) return;
        if (parent && parent.type === 'SwitchCase') return;
        if (parent && parent.type === 'JSXAttribute') return;
        if (parent && parent.type === 'Property' && parent.value === node && parent.key && DATA_KEYS.has(parent.key.name ?? parent.key.value)) return;
        const s = node.value;
        if (PROPER_NOUNS.has(s)) return;
        if (looksLikeText(s) && !isTechnical(s)) report(node, `chaîne : ${s.slice(0, 100)}`);
        return;
      }
      case 'TemplateLiteral': {
        const parts = node.quasis.map((q) => q.value.cooked ?? '').join('\n');
        if (parent && parent.type === 'TaggedTemplateExpression') return;
        if (looksLikeText(parts) && !isTechnical(parts.replace(/\n/g, ''))) report(node, `modèle : ${textOf(node).slice(0, 100)}`);
        for (const e of node.expressions) visit(e, node);
        return;
      }
      default:
        break;
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent' || key === 'start' || key === 'end' || key === 'type') continue;
      const v = node[key];
      if (Array.isArray(v)) for (const c of v) visit(c, node);
      else if (v && typeof v === 'object' && typeof v.type === 'string') visit(v, node);
    }
  };
  visit(ast, null);
}

// Traductions anglaises : clés de l'objet exporté par src/i18n/en.ts.
const EN = new Set();
const enFile = path.join(SRC, 'i18n', 'en.ts');
if (fs.existsSync(enFile)) {
  const ast = parseAst(fs.readFileSync(enFile, 'utf8'), { lang: 'ts' });
  const collect = (node) => {
    if (!node || typeof node.type !== 'string') return;
    if (node.type === 'Property' && node.key && (node.key.type === 'Literal' || node.key.type === 'Identifier'))
      EN.add(node.key.type === 'Literal' ? node.key.value : node.key.name);
    for (const key of Object.keys(node)) {
      const v = node[key];
      if (Array.isArray(v)) v.forEach(collect);
      else if (v && typeof v === 'object' && typeof v.type === 'string') collect(v);
    }
  };
  collect(ast);
}

const missing = [...keys].filter(([k]) => !EN.has(k));
const unused = [...EN].filter((k) => !keys.has(k));
if (args.has('--list')) console.log(hard.join('\n'));
if (args.has('--keys')) console.log(missing.map(([k, w]) => `${w}  ${JSON.stringify(k)}`).join('\n'));
if (args.has('--unused')) console.log(unused.map((k) => JSON.stringify(k)).join('\n'));
if (args.has('--json'))
  console.log(
    JSON.stringify(
      missing.map(([k, w]) => ({ key: k, at: w })),
      null,
      1,
    ),
  );
console.log(
  `${keys.size} textes traduisibles ; ${missing.length} sans traduction anglaise ; ${hard.length} textes en dur ; ${unused.length} traductions inutilisées.`,
);
// exitCode plutôt que exit() : la sortie envoyée à un autre programme (| …) n'est pas coupée.
process.exitCode = missing.length || hard.length ? 1 : 0;
