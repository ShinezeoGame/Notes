// Bloc « Tableur » : feuille de calcul façon Excel dans une page (formules, mise en forme, plusieurs feuilles,
// import et export .xlsx / .csv). Le classeur est enregistré en JSON dans la propriété `data` du bloc : chaque
// modification est appliquée au contenu le plus récent du bloc, pour ne pas effacer celles des autres personnes.
// Deux personnes qui valident une cellule au même instant écrivent chacune tout le classeur : celle dont l'écriture
// est écartée par la synchronisation réapplique aussitôt sa saisie (voir `pending`).
import { useCallback, useContext, useEffect, useMemo, useRef } from 'react';
import type * as Y from 'yjs';
import { createReactBlockSpec, type ReactCustomBlockRenderProps } from '@blocknote/react';
import type { BlockConfig } from '@blocknote/core';
import { PageDocContext, useAppCtx } from '../context';
import { ResizableFrame, normalizeWidth } from '../resize';
import { getLang, t } from '../../lib/i18n';
import { SheetView } from '../../sheet/SheetView';
import { MAX_CELLS, countCells, indexSheet, parseWorkbook, serializeWorkbook, type Workbook } from '../../sheet/model';
import { Engine } from '../../sheet/engine';

const spreadsheetConfig = {
  type: 'spreadsheet',
  propSchema: {
    data: { default: '' },
    width: { default: 100 },
    height: { default: 320 },
  },
  content: 'none',
} as const satisfies BlockConfig;

type Props = ReactCustomBlockRenderProps<typeof spreadsheetConfig>;
type Change = (wb: Workbook) => Workbook;

/** Délai pendant lequel une modification écartée par une écriture simultanée est réappliquée. */
const RETRY_MS = 1500;

/** Début du nom des feuilles (« Feuil1 » en français, « Sheet1 » en anglais, comme Excel). */
const sheetBase = () => t('Feuil');

function SpreadsheetView({ block, editor }: Props) {
  const ctx = useAppCtx();
  const { data, width, height } = block.props;
  const editable = editor.isEditable;
  const wb = useMemo(() => parseWorkbook(data, `${sheetBase()}1`), [data]);
  /** Modifications récentes qui peuvent être réappliquées sans effet de bord (saisies, mises en forme…). */
  const pending = useRef<{ fn: Change; until: number }[]>([]);
  /** Dernier contenu écrit (ou vu) par ce bloc : une transaction des autres qui ne le change pas est ignorée. */
  const seen = useRef(data);
  const doc = useContext(PageDocContext);

  const currentData = useCallback((): string | null => {
    const cur = editor.getBlock(block.id);
    return cur && cur.type === 'spreadsheet' ? String((cur.props as { data?: string }).data ?? '') : null;
  }, [editor, block.id]);

  const apply = useCallback(
    (fn: Change, retry = false): boolean => {
      const json = currentData();
      if (json === null) return false;
      const base = json === data ? wb : parseWorkbook(json, `${sheetBase()}1`);
      const next = fn(base);
      if (next === base) return true;
      const count = countCells(next);
      if (count > MAX_CELLS && count > countCells(base)) {
        ctx.notify(t('Tableur trop grand : {max} cellules au plus.', { max: MAX_CELLS.toLocaleString(getLang()) }), 'error');
        return false;
      }
      const out = serializeWorkbook(next);
      if (out !== json) editor.updateBlock(block.id, { props: { data: out } });
      seen.current = out;
      const now = Date.now();
      pending.current = retry ? [...pending.current.filter((p) => p.until > now), { fn, until: now + RETRY_MS }] : [];
      return true;
    },
    [editor, block.id, data, wb, ctx, currentData],
  );

  // Modification venue d'une autre personne juste après les nôtres : celles qui manquent sont réappliquées.
  useEffect(() => {
    if (!doc) return;
    let timer = 0;
    const onTransaction = (tr: Y.Transaction) => {
      if (tr.local || !pending.current.length) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const now = Date.now();
        pending.current = pending.current.filter((p) => p.until > now);
        const json = currentData();
        if (!pending.current.length || json === null || json === seen.current) return;
        const base = parseWorkbook(json, `${sheetBase()}1`);
        const next = pending.current.reduce((acc, p) => p.fn(acc), base);
        const out = serializeWorkbook(next);
        if (out !== json && countCells(next) <= MAX_CELLS) editor.updateBlock(block.id, { props: { data: out } });
        seen.current = out;
      }, 30);
    };
    doc.on('afterTransaction', onTransaction);
    return () => {
      doc.off('afterTransaction', onTransaction);
      window.clearTimeout(timer);
    };
  }, [doc, editor, block.id, currentData]);

  const undo = () => {
    pending.current = [];
    editor.undo();
  };
  const redo = () => {
    pending.current = [];
    editor.redo();
  };

  const page = ctx.getPage(ctx.currentPageId);
  return (
    <ResizableFrame
      editable={editable}
      width={normalizeWidth(width)}
      onWidthCommit={(pct) => editor.updateBlock(block, { props: { width: pct } })}
      height={height}
      minHeight={120}
      maxHeight={2000}
      onHeightCommit={(px) => editor.updateBlock(block, { props: { height: px } })}
      className="nb-sheet-block"
    >
      {(liveHeight) => (
        <div contentEditable={false} className="nb-sheet-wrap">
          <SheetView
            wb={wb}
            editable={editable}
            apply={apply}
            undo={undo}
            redo={redo}
            height={liveHeight ?? height}
            fileBase={page?.title || t('Tableur')}
            sheetBase={sheetBase()}
            notify={ctx.notify}
          />
        </div>
      )}
    </ResizableFrame>
  );
}

/** Première feuille en tableau HTML (copie de la page, export) : valeurs affichées de la partie utilisée. */
function SheetTable({ data }: { data: string }) {
  const wb = parseWorkbook(data, `${sheetBase()}1`);
  const engine = new Engine(wb, getLang());
  const idx = indexSheet(wb.sheets[0]);
  const rows = Math.min(idx.rows, 500);
  const cols = Math.min(idx.cols, 50);
  return (
    <table>
      <tbody>
        {Array.from({ length: rows }, (_, r) => (
          <tr key={r}>
            {Array.from({ length: cols }, (_, c) => (
              <td key={c}>{engine.display(0, r, c).text}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export const SpreadsheetBlock = createReactBlockSpec(spreadsheetConfig, {
  // Grille interactive : l'éditeur de texte ne doit pas prendre les clics ni le clavier.
  meta: { selectable: false },
  render: (props) => <SpreadsheetView {...props} />,
  toExternalHTML: ({ block }) => <SheetTable data={block.props.data} />,
});
