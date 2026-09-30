// Atelier PDF (menu du bas « PDF ») : bibliothèque et éditeur. Chargé seulement à l'ouverture de l'atelier.
import type * as Y from 'yjs';
import { serverBase } from '../lib/api';
import { Icon } from '../icons/Icon';
import { PdfLibrary } from './model';
import { PdfLibraryView } from './PdfLibraryView';
import { PdfEditor } from './PdfEditor';
import './pdf.css';

const libraries = new WeakMap<Y.Doc, PdfLibrary>();

/** Bibliothèque de l'espace (une seule instance par document). */
export function libraryFor(doc: Y.Doc): PdfLibrary {
  let lib = libraries.get(doc);
  if (!lib) {
    lib = new PdfLibrary(doc);
    libraries.set(doc, lib);
  }
  return lib;
}

export default function PdfApp({ doc, pdfId }: { doc: Y.Doc; pdfId: string | null }) {
  const library = libraryFor(doc);
  if (!serverBase()) {
    return (
      <div className="nb-page">
        <h1 className="nb-page-title-static">
          <Icon name="filePdf" size={34} /> PDF
        </h1>
        <div className="nb-notice">
          <p>L’atelier PDF garde vos fichiers sur votre serveur Melo.</p>
          <p className="nb-muted">Ajoutez l’adresse de votre serveur dans les réglages pour l’utiliser.</p>
        </div>
      </div>
    );
  }
  return pdfId ? <PdfEditor key={pdfId} library={library} id={pdfId} /> : <PdfLibraryView library={library} />;
}
