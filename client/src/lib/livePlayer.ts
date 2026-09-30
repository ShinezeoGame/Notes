// Lecture du direct d'une caméra : le serveur envoie en continu une vidéo MP4 fragmentée (voir server/src/cameras.js),
// lue au fil de l'eau avec Media Source Extensions. Le lecteur reste au plus près du direct, libère la mémoire au fur et
// à mesure et se reconnecte seul si le flux s'interrompt (caméra redémarrée, réseau coupé…).

type MediaSourceClass = typeof MediaSource;

function mediaSourceClass(): MediaSourceClass | null {
  const w = window as unknown as { ManagedMediaSource?: MediaSourceClass; MediaSource?: MediaSourceClass };
  return w.ManagedMediaSource ?? w.MediaSource ?? null;
}

function supported(MS: MediaSourceClass, codec: string): boolean {
  try {
    return MS.isTypeSupported(`video/mp4; codecs="${codec}"`);
  } catch {
    return false;
  }
}

let formats: string[] | null = null;

/** Formats vidéo que cet appareil sait lire, par ordre de préférence : le serveur réemballe ou convertit en conséquence. */
export function acceptedFormats(): string[] {
  if (formats) return formats;
  const MS = mediaSourceClass();
  const out: string[] = [];
  if (MS) {
    if (supported(MS, 'avc1.640028') || supported(MS, 'avc1.42e01e')) out.push('avc');
    if (supported(MS, 'hvc1.1.6.L120.90') || supported(MS, 'hev1.1.6.L120.90')) out.push('hevc');
    if (supported(MS, 'vp09.00.31.08')) out.push('vp9');
  }
  formats = out;
  return out;
}

export type PlayerState = 'connecting' | 'playing' | 'retrying' | 'error';

/** Nombre maximal de secondes de retard sur le direct avant de sauter en avant. */
const MAX_DELAY = 2;
/** Vidéo gardée en mémoire derrière la position de lecture (secondes). */
const KEEP_BEHIND = 10;
/** Sans nouvelles données pendant ce délai, le flux est relancé. */
const STALL_MS = 15_000;

function concat(chunks: Uint8Array[]): Uint8Array {
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export class LivePlayer {
  private readonly video: HTMLVideoElement;
  /** Adresse relue à chaque connexion (les adresses signées sont renouvelées régulièrement). */
  private readonly url: () => string;
  private readonly onState: (state: PlayerState, message?: string) => void;
  private stopped = true;
  private session = 0;
  private abort: AbortController | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private objectUrl = '';

  constructor(video: HTMLVideoElement, url: () => string, onState: (state: PlayerState, message?: string) => void) {
    this.video = video;
    this.url = url;
    this.onState = onState;
  }

  start() {
    this.stopped = false;
    void this.run();
  }

  stop() {
    this.stopped = true;
    this.session++;
    clearTimeout(this.retryTimer);
    this.abort?.abort();
    this.detach();
  }

  private detach() {
    const v = this.video;
    v.removeAttribute('src');
    try {
      v.load();
    } catch {
      /* élément retiré */
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = '';
  }

  private retry(session: number, message: string, fatal = false) {
    if (session !== this.session || this.stopped) return;
    this.session++;
    this.abort?.abort();
    this.detach();
    if (fatal) {
      this.onState('error', message);
      return;
    }
    this.attempt++;
    const delay = Math.min(30_000, 1000 * 2 ** Math.min(this.attempt - 1, 5));
    this.onState('retrying', message);
    this.retryTimer = setTimeout(() => {
      if (!this.stopped) void this.run();
    }, delay);
  }

  private async run() {
    const session = ++this.session;
    const MS = mediaSourceClass();
    const accept = acceptedFormats();
    if (!MS || !accept.length) {
      this.onState('error', 'Cet appareil ne sait pas lire la vidéo en direct.');
      return;
    }
    if (!this.attempt) this.onState('connecting');
    const abort = new AbortController();
    this.abort = abort;
    let res: Response;
    try {
      res = await fetch(`${this.url()}&accept=${accept.join(',')}`, { signal: abort.signal, cache: 'no-store' });
    } catch {
      return this.retry(session, 'Serveur Melo injoignable.');
    }
    if (session !== this.session) return;
    if (!res.ok || !res.body) {
      let message = `Erreur ${res.status}`;
      try {
        message = ((await res.json()) as { error?: string }).error || message;
      } catch {
        /* pas de JSON */
      }
      // 404 : caméra supprimée ; 415 : format illisible. (403 : adresse expirée, renouvelée d'ici le prochain essai.)
      return this.retry(session, message, [404, 415].includes(res.status));
    }
    const codec = res.headers.get('X-Camera-Codec') || 'avc1.42e01e';
    const mime = `video/mp4; codecs="${codec}"`;
    if (!supported(MS, `${codec}`)) return this.retry(session, 'Format vidéo non pris en charge par cet appareil.', true);

    const ms = new MS();
    const video = this.video;
    this.objectUrl = URL.createObjectURL(ms);
    video.disableRemotePlayback = true;
    video.muted = true;
    video.playsInline = true;
    video.src = this.objectUrl;
    await new Promise((resolve) => ms.addEventListener('sourceopen', resolve, { once: true }));
    if (session !== this.session) return;

    let sb: SourceBuffer;
    try {
      sb = ms.addSourceBuffer(mime);
    } catch {
      return this.retry(session, 'Format vidéo non pris en charge par cet appareil.', true);
    }
    const queue: Uint8Array[] = [];
    const pump = () => {
      if (session !== this.session || sb.updating || !queue.length || ms.readyState !== 'open') return;
      const data = concat(queue.splice(0));
      try {
        sb.appendBuffer(data as BufferSource);
      } catch (err) {
        if (err instanceof DOMException && err.name === 'QuotaExceededError') {
          // Mémoire du lecteur pleine : on libère le passé et on réessaie.
          queue.unshift(data);
          this.trim(sb, true);
        } else {
          this.retry(session, 'Lecture de la vidéo interrompue.');
        }
      }
    };
    sb.addEventListener('updateend', () => {
      if (session !== this.session) return;
      this.keepLive(sb);
      pump();
    });
    sb.addEventListener('error', () => this.retry(session, 'Lecture de la vidéo interrompue.'));
    video.addEventListener(
      'playing',
      () => {
        if (session !== this.session) return;
        this.attempt = 0;
        this.onState('playing');
      },
      { once: true },
    );
    video.addEventListener('error', () => this.retry(session, 'Lecture de la vidéo interrompue.'), { once: true });

    let lastData = Date.now();
    const watchdog = setInterval(() => {
      if (Date.now() - lastData > STALL_MS) this.retry(session, 'La caméra n’envoie plus d’images.');
    }, 5_000);
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { value, done } = await reader.read();
        if (done || session !== this.session) break;
        lastData = Date.now();
        queue.push(value);
        pump();
      }
    } catch {
      /* flux interrompu ou arrêté */
    } finally {
      clearInterval(watchdog);
    }
    this.retry(session, 'Flux interrompu, reconnexion…');
  }

  /** Reste proche du direct : saute en avant si la lecture a pris du retard ou si le flux a sauté des images. */
  private keepLive(sb: SourceBuffer) {
    const v = this.video;
    const b = v.buffered;
    if (!b.length) return;
    const start = b.start(b.length - 1);
    const end = b.end(b.length - 1);
    if (v.currentTime < start || end - v.currentTime > MAX_DELAY) v.currentTime = Math.max(start, end - 0.3);
    if (v.paused) void v.play().catch(() => {});
    this.trim(sb);
  }

  private trim(sb: SourceBuffer, force = false) {
    const v = this.video;
    const b = v.buffered;
    if (sb.updating || !b.length) return;
    const from = b.start(0);
    const to = v.currentTime - (force ? 1 : KEEP_BEHIND);
    if (to - from > (force ? 0 : 20)) {
      try {
        sb.remove(from, to);
      } catch {
        /* rien à libérer */
      }
    }
  }
}
