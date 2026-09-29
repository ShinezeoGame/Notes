// QPDF (compilé en WebAssembly, chargé seulement quand il sert) : retire la protection d'un PDF chiffré à
// l'import et répare les fichiers mal formés que la bibliothèque d'écriture refuse.
import wasmUrl from '@neslinesli93/qpdf-wasm/dist/qpdf.wasm?url';

type QpdfInstance = {
  callMain: (args: string[]) => number;
  FS: { writeFile: (path: string, data: Uint8Array) => void; readFile: (path: string) => Uint8Array };
};
type CreateQpdf = (opts: {
  locateFile: () => string;
  noInitialRun: boolean;
  print: (text: string) => void;
  printErr: (text: string) => void;
}) => Promise<QpdfInstance>;

/** Mot de passe absent ou faux. */
export class PdfPasswordError extends Error {
  constructor(readonly wrong: boolean) {
    super(wrong ? 'Mot de passe incorrect.' : 'Ce PDF est protégé par un mot de passe.');
  }
}

async function run(args: string[], input: Uint8Array): Promise<{ output: Uint8Array | null; log: string }> {
  const { default: createModule } = (await import('@neslinesli93/qpdf-wasm')) as unknown as { default: CreateQpdf };
  const log: string[] = [];
  const capture = (...a: unknown[]) => void log.push(a.join(' '));
  // Le module lit console.log / console.error à sa création (et ignore print / printErr) : on les remplace
  // le temps de cette création seulement, pour recueillir ses messages.
  const { log: consoleLog, error: consoleError } = console;
  console.log = capture;
  console.error = capture;
  let created: Promise<QpdfInstance>;
  try {
    // Une instance par opération : le module garde son état (fichiers, sortie) après l'exécution.
    created = createModule({ locateFile: () => wasmUrl, noInitialRun: true, print: capture, printErr: capture });
  } finally {
    console.log = consoleLog;
    console.error = consoleError;
  }
  const qpdf = await created;
  qpdf.FS.writeFile('/in.pdf', input);
  try {
    qpdf.callMain([...args, '/in.pdf', '/out.pdf']);
  } catch (err) {
    log.push(String(err));
  }
  let output: Uint8Array | null = null;
  try {
    output = qpdf.FS.readFile('/out.pdf');
  } catch {
    output = null;
  }
  return { output: output && output.length > 0 ? output : null, log: log.join('\n') };
}

/** Copie non chiffrée d'un PDF (mot de passe d'ouverture si le PDF en demande un). */
export async function decryptPdf(bytes: Uint8Array, password = ''): Promise<Uint8Array> {
  const args = ['--decrypt'];
  if (password) args.push(`--password=${password}`);
  const { output, log } = await run(args, bytes);
  if (output) return output;
  if (/invalid password/i.test(log)) throw new PdfPasswordError(Boolean(password));
  throw new Error('Ce PDF est illisible ou endommagé.');
}

/** Réécrit un PDF mal formé (tables de références, objets abîmés) en fichier propre. */
export async function repairPdf(bytes: Uint8Array): Promise<Uint8Array> {
  const { output } = await run(['--decrypt'], bytes);
  if (!output) throw new Error('Ce PDF est endommagé et n’a pas pu être réparé.');
  return output;
}

/** Vrai si le fichier contient un dictionnaire de chiffrement (/Encrypt). */
export function looksEncrypted(bytes: Uint8Array): boolean {
  const needle = [0x2f, 0x45, 0x6e, 0x63, 0x72, 0x79, 0x70, 0x74]; // "/Encrypt"
  outer: for (let i = 0; i <= bytes.length - needle.length; i++) {
    if (bytes[i] !== 0x2f) continue;
    for (let j = 1; j < needle.length; j++) if (bytes[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}
