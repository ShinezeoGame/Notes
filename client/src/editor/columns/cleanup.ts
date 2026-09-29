// Après une suppression qui part d'une rangée de colonnes et couvre plusieurs colonnes ou va au-delà (tout
// sélectionner puis Effacer, couper…), ProseMirror garde la structure de la rangée, vidée. Une rangée dont toutes les
// colonnes sont vides redevient alors un simple paragraphe. Les rangées vides créées exprès (menu « / ») ne sont pas
// concernées.
import type { Node as PMNode, ResolvedPos } from 'prosemirror-model';
import { Plugin, PluginKey, TextSelection } from 'prosemirror-state';
import { isEmptyColumn } from '@blocknote/core';

/** Rangée de colonnes qui contient cette position (position avant la rangée), ou null. */
function rowAt($pos: ResolvedPos): { pos: number; node: PMNode } | null {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'columnList') return { pos: $pos.before(d), node: $pos.node(d) };
  }
  return null;
}

/** Position avant la colonne qui contient cette position, ou null. */
function columnAt($pos: ResolvedPos): number | null {
  for (let d = $pos.depth; d > 0; d--) {
    if ($pos.node(d).type.name === 'column') return $pos.before(d);
  }
  return null;
}

export function columnsCleanupPlugin() {
  return new Plugin({
    key: new PluginKey('nbColumnsCleanup'),
    appendTransaction(trs, oldState, state) {
      // Seulement pour une modification faite sur cet appareil (pas celles reçues d'un autre).
      if (!trs.some((tr) => tr.docChanged) || trs.some((tr) => tr.getMeta('y-sync$')?.isChangeOrigin)) return null;
      const { $from, $to, empty } = oldState.selection;
      if (empty) return null;
      // La sélection supprimée partait d'une rangée et couvrait plus d'une colonne (ou sortait de la rangée).
      const start = rowAt($from);
      if (!start || (rowAt($to)?.pos === start.pos && columnAt($from) === columnAt($to))) return null;
      const row = rowAt(state.selection.$from);
      if (!row) return null;
      let allEmpty = true;
      row.node.forEach((column) => {
        if (column.type.name !== 'column' || !isEmptyColumn(column)) allEmpty = false;
      });
      if (!allEmpty) return null;
      const block = state.schema.nodes.blockContainer.createAndFill();
      if (!block) return null;
      const tr = state.tr.replaceWith(row.pos, row.pos + row.node.nodeSize, block);
      return tr.setSelection(TextSelection.near(tr.doc.resolve(row.pos + 1)));
    },
  });
}
