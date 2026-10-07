// Atelier PDF (menu du bas « PDF ») : bibliothèque et éditeur. Chargé seulement à l'ouverture de l'atelier.
import { useContext } from 'react';
import type * as Y from 'yjs';
import { serverBase } from '../lib/api';
import { AppContext } from '../editor/context';
import { NeedsServerIntro, hideSection } from '../components/SectionIntro';
import { Icon } from '../icons/Icon';
import { PdfLibrary } from './model';
import { PdfLibraryView } from './PdfLibraryView';
import { PdfEditor } from './PdfEditor';
import { t } from '../lib/i18n';
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
  const ctx = useContext(AppContext);
  const library = libraryFor(doc);
  const hide = () => hideSection(doc, 'pdf');
  if (!serverBase()) {
    return (
      <div className="nb-page">
        <h1 className="nb-page-title-static">
          <Icon name="filePdf" size={34} /> {t('Atelier PDF')}
        </h1>
        <NeedsServerIntro
          icon="filePdf"
          title={t('Signez et remplissez vos PDF')}
          need={t('Un serveur Melo (chez vous ou chez un proche) : c’est lui qui garde vos fichiers PDF.')}
          onJoin={ctx?.joinServer}
          onHide={hide}
        >
          {t('Signer, remplir un formulaire, annoter, réorganiser les pages ou assembler plusieurs PDF, et transformer des photos en PDF.')}
        </NeedsServerIntro>
      </div>
    );
  }
  return pdfId ? <PdfEditor key={pdfId} library={library} id={pdfId} /> : <PdfLibraryView library={library} onHide={hide} />;
}
