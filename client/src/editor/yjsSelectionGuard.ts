// Protection de la synchronisation Yjs : quand un changement arrive (annulation Ctrl+Z, modification venue d'un autre
// appareil), y-prosemirror rétablit la sélection d'avant. Si c'était un bloc sélectionné en entier (module caméra,
// agenda… juste déposé ou cliqué), il le resélectionne à sa position calculée ; quand le bloc n'y est plus (annulation
// d'un déplacement), la bibliothèque plante et le changement n'est pas appliqué. On mémorise alors un simple curseur
// à cet endroit.
import { Plugin, PluginKey } from 'prosemirror-state';
import type { EditorView } from 'prosemirror-view';
import { ySyncPluginKey } from 'y-prosemirror';
import { createExtension } from '@blocknote/core';

type RelativeSelection = { type: string; anchor: unknown; head: unknown } | null;
type Binding = {
  doc: { on: (e: string, f: () => void) => void; off: (e: string, f: () => void) => void };
  prosemirrorView: EditorView | null;
  beforeTransactionSelection: RelativeSelection;
  beforeAllTransactions: () => void;
  nbGuarded?: boolean;
};

function guard(view: EditorView) {
  const binding = (ySyncPluginKey.getState(view.state) as { binding?: Binding } | undefined)?.binding;
  if (!binding || binding.nbGuarded) return;
  binding.nbGuarded = true;
  const original = binding.beforeAllTransactions;
  const wrapped = () => {
    original();
    const sel = binding.beforeTransactionSelection;
    if (sel?.type === 'node') binding.beforeTransactionSelection = { ...sel, type: 'text', head: sel.anchor };
  };
  // Même écouteur remplacé : y-prosemirror le retire et le remet lui-même (initView, destroy).
  const listening = binding.prosemirrorView != null;
  if (listening) binding.doc.off('beforeAllTransactions', original);
  binding.beforeAllTransactions = wrapped;
  if (listening) binding.doc.on('beforeAllTransactions', wrapped);
}

export const yjsSelectionGuard = createExtension(() => ({
  key: 'nbYjsSelectionGuard',
  prosemirrorPlugins: [
    new Plugin({
      key: new PluginKey('nbYjsSelectionGuard'),
      view: (view) => {
        guard(view);
        return { update: guard };
      },
    }),
  ],
}));
