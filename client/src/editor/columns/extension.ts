// Comportements des colonnes ajoutés à l'éditeur avec leurs blocs : dépôt à côté d'un bloc, réglage des largeurs,
// nettoyage d'une rangée vidée par une suppression.
import { createExtension } from '@blocknote/core';
import { SideMenuExtension } from '@blocknote/core/extensions';
import { columnsCleanupPlugin } from './cleanup';
import { columnsDropPlugin } from './drop';
import { columnsResizePlugin } from './resize';

export const columnsExtension = createExtension(({ editor }) => ({
  key: 'nbColumns',
  prosemirrorPlugins: [
    columnsDropPlugin(() => editor.getExtension(SideMenuExtension)?.blockDragEnd()),
    columnsResizePlugin(),
    columnsCleanupPlugin(),
  ],
}));
