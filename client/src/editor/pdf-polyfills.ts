// Fonctions récentes des navigateurs utilisées par pdf.js mais absentes des WebView Android jamais mises à jour
// (Chrome 113 d'origine sur Android 14, par exemple). Le build « legacy » de pdf.js en couvre beaucoup d'autres,
// pas celles-ci. Chargé avant pdf.js, dans la page (editor/pdf.ts) et dans son worker (editor/pdf-worker.ts).

function define(target: object, key: PropertyKey, value: unknown) {
  Object.defineProperty(target, key, { value, writable: true, configurable: true, enumerable: false });
}

// Promise.withResolvers (Chrome 119) : utilisé à l'ouverture de tout PDF.
if (typeof (Promise as { withResolvers?: unknown }).withResolvers !== 'function') {
  define(Promise, 'withResolvers', function withResolvers(this: unknown) {
    const C = (typeof this === 'function' ? this : Promise) as PromiseConstructor;
    let resolve!: (value: unknown) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new C((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  });
}

// ArrayBuffer.prototype.transferToFixedLength / transfer (Chrome 114) : polices de chaque page, dans le worker.
// Copie au lieu d'un transfert : pdf.js ne réutilise pas le tampon d'origine.
{
  const proto = ArrayBuffer.prototype as ArrayBuffer & { transfer?: unknown; transferToFixedLength?: unknown };
  const transfer = function (this: ArrayBuffer, newLength?: number) {
    const length = newLength === undefined ? this.byteLength : Math.max(0, Math.trunc(Number(newLength)) || 0);
    const copy = new ArrayBuffer(length);
    new Uint8Array(copy).set(new Uint8Array(this, 0, Math.min(length, this.byteLength)));
    return copy;
  };
  if (typeof proto.transferToFixedLength !== 'function') define(proto, 'transferToFixedLength', transfer);
  if (typeof proto.transfer !== 'function') define(proto, 'transfer', transfer);
}

// Blob / Response .bytes() (Chrome 132) : décompression, enregistrement des formulaires, images.
for (const C of [typeof Blob === 'undefined' ? null : Blob, typeof Response === 'undefined' ? null : Response]) {
  if (C && typeof (C.prototype as { bytes?: unknown }).bytes !== 'function') {
    define(C.prototype, 'bytes', async function bytes(this: Blob | Response) {
      return new Uint8Array(await this.arrayBuffer());
    });
  }
}

// Parcours d'un ReadableStream avec « for await » (Chrome 124) : décompression dans le worker, texte des pages.
if (typeof ReadableStream !== 'undefined' && !(Symbol.asyncIterator in ReadableStream.prototype)) {
  const values = function (this: ReadableStream, options?: { preventCancel?: boolean }) {
    const reader = this.getReader();
    const preventCancel = Boolean(options?.preventCancel);
    let finished = false;
    return {
      async next() {
        if (finished) return { done: true, value: undefined };
        try {
          const r = await reader.read();
          if (r.done) {
            finished = true;
            reader.releaseLock();
          }
          return r;
        } catch (err) {
          finished = true;
          reader.releaseLock();
          throw err;
        }
      },
      async return(value?: unknown) {
        if (!finished) {
          finished = true;
          const cancelled = preventCancel ? undefined : reader.cancel(value);
          reader.releaseLock();
          await cancelled;
        }
        return { done: true, value };
      },
      [Symbol.asyncIterator]() {
        return this;
      },
    };
  };
  define(ReadableStream.prototype, 'values', values);
  define(ReadableStream.prototype, Symbol.asyncIterator, values);
}

// AbortSignal.any (Chrome 116).
if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal as { any?: unknown }).any !== 'function') {
  define(AbortSignal, 'any', function any(signals: Iterable<AbortSignal>) {
    const controller = new AbortController();
    const list = [...signals];
    const aborted = list.find((s) => s.aborted);
    if (aborted) {
      controller.abort(aborted.reason);
      return controller.signal;
    }
    for (const s of list) s.addEventListener('abort', () => controller.abort(s.reason), { once: true, signal: controller.signal });
    return controller.signal;
  });
}

// Map / WeakMap .getOrInsert / .getOrInsertComputed (très récents).
for (const proto of [Map.prototype, WeakMap.prototype] as unknown as Record<string, unknown>[]) {
  if (typeof proto.getOrInsert !== 'function') {
    define(proto, 'getOrInsert', function (this: Map<unknown, unknown>, key: unknown, value: unknown) {
      if (!this.has(key)) this.set(key, value);
      return this.get(key);
    });
  }
  if (typeof proto.getOrInsertComputed !== 'function') {
    define(proto, 'getOrInsertComputed', function (this: Map<unknown, unknown>, key: unknown, compute: (k: unknown) => unknown) {
      if (!this.has(key)) this.set(key, compute(key));
      return this.get(key);
    });
  }
}

export {};
