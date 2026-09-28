// Transforme un lien "public" (YouTube, Vimeo, Google Agenda…) en URL intégrable dans une iframe.
export type EmbedInfo = { src: string; kind: 'youtube' | 'vimeo' | 'dailymotion' | 'gcal' | 'gdrive' | 'loom' | 'spotify' | 'figma' | 'maps' | 'generic'; ratio?: number };

function safeUrl(input: string): URL | null {
  try {
    const u = new URL(input.trim());
    return /^https?:$/.test(u.protocol) ? u : null;
  } catch {
    return null;
  }
}

export function normalizeEmbedUrl(input: string): EmbedInfo | null {
  const u = safeUrl(input);
  if (!u) return null;
  const host = u.hostname.replace(/^www\./, '').replace(/^m\./, '');

  // YouTube
  if (host === 'youtu.be' || host.endsWith('youtube.com') || host === 'youtube-nocookie.com') {
    let id = '';
    if (host === 'youtu.be') id = u.pathname.slice(1).split('/')[0];
    else if (u.searchParams.get('v')) id = u.searchParams.get('v')!;
    else {
      const m = /\/(?:embed|shorts|live|v)\/([A-Za-z0-9_-]{6,})/.exec(u.pathname);
      if (m) id = m[1];
    }
    if (id) {
      const params = new URLSearchParams();
      const t = u.searchParams.get('t') || u.searchParams.get('start');
      if (t) params.set('start', String(parseInt(t, 10) || 0));
      const list = u.searchParams.get('list');
      if (list) params.set('list', list);
      const q = params.toString();
      return { src: `https://www.youtube-nocookie.com/embed/${id}${q ? `?${q}` : ''}`, kind: 'youtube', ratio: 16 / 9 };
    }
  }
  // Vimeo
  if (host.endsWith('vimeo.com')) {
    const m = /(\d{6,})/.exec(u.pathname);
    if (m) return { src: `https://player.vimeo.com/video/${m[1]}`, kind: 'vimeo', ratio: 16 / 9 };
  }
  // Dailymotion
  if (host.endsWith('dailymotion.com') || host === 'dai.ly') {
    const m = host === 'dai.ly' ? /^\/([a-z0-9]+)/i.exec(u.pathname) : /\/video\/([a-z0-9]+)/i.exec(u.pathname);
    if (m) return { src: `https://www.dailymotion.com/embed/video/${m[1]}`, kind: 'dailymotion', ratio: 16 / 9 };
  }
  // Google Agenda
  if (host === 'calendar.google.com') {
    if (u.pathname.startsWith('/calendar/embed')) return { src: u.toString(), kind: 'gcal' };
    const cid = u.searchParams.get('cid');
    if (cid) {
      let src = cid;
      try {
        src = atob(cid.replace(/-/g, '+').replace(/_/g, '/'));
      } catch {
        /* cid déjà en clair */
      }
      const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris';
      return { src: `https://calendar.google.com/calendar/embed?src=${encodeURIComponent(src)}&ctz=${encodeURIComponent(tz)}`, kind: 'gcal' };
    }
  }
  // Google Drive / Docs / Sheets / Slides
  if (host === 'drive.google.com' || host === 'docs.google.com') {
    const m = /^(\/(?:file|document|spreadsheets|presentation|forms)\/d\/[^/]+)/.exec(u.pathname);
    if (m) return { src: `https://${host}${m[1]}/preview`, kind: 'gdrive' };
  }
  // Google Maps (lien d'intégration uniquement)
  if (host === 'google.com' && u.pathname.startsWith('/maps/embed')) return { src: u.toString(), kind: 'maps' };
  // Loom
  if (host.endsWith('loom.com')) {
    const m = /\/(?:share|embed)\/([a-f0-9]{16,})/i.exec(u.pathname);
    if (m) return { src: `https://www.loom.com/embed/${m[1]}`, kind: 'loom', ratio: 16 / 9 };
  }
  // Spotify
  if (host === 'open.spotify.com') {
    const m = /^\/(?:embed\/)?(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]+)/.exec(u.pathname);
    if (m) return { src: `https://open.spotify.com/embed/${m[1]}/${m[2]}`, kind: 'spotify' };
  }
  // Figma
  if (host.endsWith('figma.com') && !u.pathname.startsWith('/embed')) {
    return { src: `https://www.figma.com/embed?embed_host=share&url=${encodeURIComponent(u.toString())}`, kind: 'figma' };
  }
  return { src: u.toString(), kind: 'generic' };
}

export function isDirectMediaUrl(url: string): 'image' | 'video' | 'audio' | null {
  const clean = url.split('?')[0].toLowerCase();
  if (/\.(png|jpe?g|gif|webp|avif|svg|bmp)$/.test(clean)) return 'image';
  if (/\.(mp4|webm|ogv|mov|m4v)$/.test(clean)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|flac|aac)$/.test(clean)) return 'audio';
  return null;
}
