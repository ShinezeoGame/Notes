// Colonnes : des blocs côte à côte (un texte à côté d'une image, une vidéo à côté d'un module…). Une rangée
// (« columnList ») contient au moins deux colonnes (« column »), chacune avec ses blocs. Noms, groupes et structure
// sont ceux qu'attend BlockNote : il sait déjà déplacer, supprimer et nettoyer des blocs placés dans des colonnes,
// et son CSS met déjà les colonnes en forme (classes bn-block-column-list / bn-block-column).
import { Node } from '@tiptap/core';
import { createBlockSpecFromTiptapNode } from '@blocknote/core';
import { columnsExtension } from './extension';
import { columnWidth } from './util';

/** Élément d'une rangée ou d'une colonne ; BlockNote exige la forme { dom, contentDOM } (export HTML, glisser). */
function element(className: string, nodeType: string, attributes: Record<string, unknown>) {
  const dom = document.createElement('div');
  dom.className = className;
  dom.setAttribute('data-node-type', nodeType);
  for (const [name, value] of Object.entries(attributes)) {
    if (value != null && name !== 'class') dom.setAttribute(name, String(value));
  }
  return { dom, contentDOM: dom };
}

// Priorité plus basse que le bloc ordinaire de BlockNote (50) : quand ProseMirror doit créer un bloc par défaut
// (page vidée, par exemple), il prend le premier type du schéma, qui doit rester un paragraphe, pas une rangée.
const ColumnList = Node.create({
  name: 'columnList',
  priority: 40,
  group: 'childContainer bnBlock blockGroupChild',
  content: 'column column+', // i18n-ignore
  parseHTML() {
    return [{ tag: 'div[data-node-type="columnList"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return element('bn-block-column-list', 'columnList', HTMLAttributes);
  },
});

const Column = Node.create({
  name: 'column',
  priority: 40,
  group: 'bnBlock childContainer',
  content: 'blockContainer+',
  addAttributes() {
    return {
      width: {
        default: 1,
        parseHTML: (el) => columnWidth(el.getAttribute('data-width')),
        renderHTML: (attrs) => {
          const width = columnWidth(attrs.width);
          return { 'data-width': String(width), style: `flex-grow: ${width}` };
        },
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-node-type="column"]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return element('bn-block-column', 'column', HTMLAttributes);
  },
});

/** Blocs « rangée de colonnes » et « colonne » du schéma de l'éditeur. */
export const columnBlockSpecs = {
  columnList: createBlockSpecFromTiptapNode({ node: ColumnList, type: 'columnList', content: 'none' }, {}, [columnsExtension()]),
  column: createBlockSpecFromTiptapNode({ node: Column, type: 'column', content: 'none' }, { width: { default: 1 } }),
};
