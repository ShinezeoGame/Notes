// Commandes de taille de l'éditeur : menu « Taille » des blocs (poignée ⠿) et listes de la barre de mise en forme.
import {
  BlockColorsItem,
  DragHandleMenu,
  RemoveBlockItem,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  useActiveStyles,
  useBlockNoteEditor,
  useComponentsContext,
  useDictionary,
  useExtensionState,
  usePortalElement,
  useSelectedBlocks,
} from '@blocknote/react';
import type { BlockNoteEditor } from '@blocknote/core';
import { SideMenuExtension } from '@blocknote/core/extensions';
import { Icon } from '../icons/Icon';
import { TEXT_SIZES, applyBlockTextSize, blockTextSize, supportsTextSize } from './styles/TextSize';
import { WIDTH_PRESETS, normalizeWidth } from './resize';
import { columnOf, columnShare, setColumnShare } from './columns';

type AnyEditor = BlockNoteEditor<any, any, any>;
type LooseBlock = { id: string; type: string; props: Record<string, unknown>; content?: unknown };

/** Blocs de média dont la largeur se règle : images et vidéos (px) ou blocs personnalisés (%). */
const PREVIEW_WIDTH_BLOCKS = new Set(['image', 'video']);
const PERCENT_WIDTH_BLOCKS = new Set(['pdf', 'embed', 'calendar', 'homelab']);

export function supportsWidth(block: LooseBlock): boolean {
  return PREVIEW_WIDTH_BLOCKS.has(block.type) || PERCENT_WIDTH_BLOCKS.has(block.type);
}

/** Largeur disponible pour un bloc : celle de sa colonne s'il est dans une colonne, sinon celle de la page. */
function availableWidth(editor: AnyEditor, blockId: string): number {
  const root = editor.domElement;
  const column = root?.querySelector(`[data-id="${CSS.escape(blockId)}"]`)?.closest('.bn-block-column');
  if (column instanceof HTMLElement) {
    const cs = getComputedStyle(column);
    return column.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) || 700;
  }
  return (root?.firstElementChild as HTMLElement | null | undefined)?.clientWidth || 700;
}

/** Largeur actuelle d'un bloc de média, en % de la place disponible (page ou colonne). */
export function blockWidthPercent(editor: AnyEditor, block: LooseBlock): number {
  if (PERCENT_WIDTH_BLOCKS.has(block.type)) return normalizeWidth(block.props.width);
  const px = Number(block.props.previewWidth);
  if (!Number.isFinite(px) || px <= 0) return 100;
  return Math.min(100, Math.round((px / availableWidth(editor, block.id)) * 100));
}

export function applyBlockWidth(editor: AnyEditor, blockRef: LooseBlock, pct: number) {
  const block = (editor.getBlock(blockRef.id) as LooseBlock | undefined) ?? blockRef;
  if (PERCENT_WIDTH_BLOCKS.has(block.type)) {
    editor.updateBlock(block.id, { props: { width: pct } } as never);
  } else if (PREVIEW_WIDTH_BLOCKS.has(block.type)) {
    editor.updateBlock(block.id, { props: { previewWidth: Math.round((availableWidth(editor, block.id) * pct) / 100) } } as never);
  }
}

const nearestPreset = (pct: number) => WIDTH_PRESETS.reduce((best, p) => (Math.abs(p - pct) < Math.abs(best - pct) ? p : best), 100);

/** Sous-menu « Taille du texte » ou « Largeur » dans le menu de la poignée d'un bloc. */
function BlockSizeItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor() as AnyEditor;
  const portal = usePortalElement();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (s: { block?: unknown } | undefined) => s?.block }) as LooseBlock | undefined;
  if (!block || !editor.isEditable) return null;

  if (supportsTextSize(block)) {
    const current = blockTextSize((editor.getBlock(block.id) as LooseBlock | undefined) ?? block);
    return (
      <Components.Generic.Menu.Root position="right" sub portalElement={portal}>
        <Components.Generic.Menu.Trigger sub>
          <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
            Taille du texte
          </Components.Generic.Menu.Item>
        </Components.Generic.Menu.Trigger>
        <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown nb-size-dropdown">
          {TEXT_SIZES.map((t) => (
            <Components.Generic.Menu.Item
              key={t.label}
              className="bn-menu-item"
              icon={<Icon name="textSize" size={t.iconSize} />}
              checked={current === t.value}
              onClick={() => applyBlockTextSize(editor, block, t.value)}
            >
              {t.label}
            </Components.Generic.Menu.Item>
          ))}
        </Components.Generic.Menu.Dropdown>
      </Components.Generic.Menu.Root>
    );
  }

  if (supportsWidth(block)) {
    const current = nearestPreset(blockWidthPercent(editor, block));
    return (
      <Components.Generic.Menu.Root position="right" sub portalElement={portal}>
        <Components.Generic.Menu.Trigger sub>
          <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
            Largeur
          </Components.Generic.Menu.Item>
        </Components.Generic.Menu.Trigger>
        <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown nb-size-dropdown">
          {WIDTH_PRESETS.map((pct) => (
            <Components.Generic.Menu.Item
              key={pct}
              className="bn-menu-item"
              icon={<Icon name="resize" size={14} />}
              checked={current === pct}
              onClick={() => applyBlockWidth(editor, block, pct)}
            >
              {pct === 100 ? 'Pleine largeur' : `${pct} %`}
            </Components.Generic.Menu.Item>
          ))}
        </Components.Generic.Menu.Dropdown>
      </Components.Generic.Menu.Root>
    );
  }
  return null;
}

const COLUMN_SHARES = [
  { label: 'Un quart de la ligne', value: 1 / 4 },
  { label: 'Un tiers', value: 1 / 3 },
  { label: 'La moitié', value: 1 / 2 },
  { label: 'Deux tiers', value: 2 / 3 },
  { label: 'Trois quarts', value: 3 / 4 },
];

/** Sous-menu « Largeur de la colonne » pour un bloc placé dans une colonne (utile aussi sans souris). */
function ColumnWidthItem() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor() as AnyEditor;
  const portal = usePortalElement();
  const block = useExtensionState(SideMenuExtension, { editor, selector: (s: { block?: unknown } | undefined) => s?.block }) as LooseBlock | undefined;
  if (!block || !editor.isEditable) return null;
  const found = columnOf(editor, block.id);
  if (!found) return null;
  const share = columnShare(found.list, found.column.id);
  const equal = found.list.children.every((c) => Number(c.props.width ?? 1) === Number(found.list.children[0].props.width ?? 1));
  return (
    <Components.Generic.Menu.Root position="right" sub portalElement={portal}>
      <Components.Generic.Menu.Trigger sub>
        <Components.Generic.Menu.Item className="bn-menu-item" subTrigger>
          Largeur de la colonne
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Trigger>
      <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown nb-size-dropdown">
        {COLUMN_SHARES.map((p) => (
          <Components.Generic.Menu.Item
            key={p.label}
            className="bn-menu-item"
            icon={<Icon name="columns2" size={14} />}
            checked={!equal && Math.abs(share - p.value) < 0.02}
            onClick={() => setColumnShare(editor, found.column.id, p.value)}
          >
            {p.label}
          </Components.Generic.Menu.Item>
        ))}
        <Components.Generic.Menu.Item
          className="bn-menu-item"
          icon={<Icon name="columns3" size={14} />}
          checked={equal}
          onClick={() => setColumnShare(editor, found.column.id, null)}
        >
          Parts égales
        </Components.Generic.Menu.Item>
      </Components.Generic.Menu.Dropdown>
    </Components.Generic.Menu.Root>
  );
}

/** Menu de la poignée ⠿ : options par défaut + taille + largeur de la colonne. */
export function NotesDragHandleMenu() {
  const dict = useDictionary();
  return (
    <DragHandleMenu>
      <RemoveBlockItem>{dict.drag_handle.delete_menuitem}</RemoveBlockItem>
      <BlockColorsItem>{dict.drag_handle.colors_menuitem}</BlockColorsItem>
      <BlockSizeItem />
      <ColumnWidthItem />
      <TableRowHeaderItem>{dict.drag_handle.header_row_menuitem}</TableRowHeaderItem>
      <TableColumnHeaderItem>{dict.drag_handle.header_column_menuitem}</TableColumnHeaderItem>
    </DragHandleMenu>
  );
}

/** Liste « taille du texte » de la barre de mise en forme (sélection de texte). */
export function TextSizeSelect() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor() as AnyEditor;
  const portal = usePortalElement();
  const styles = useActiveStyles(editor) as Record<string, unknown>;
  const blocks = useSelectedBlocks(editor) as LooseBlock[];
  if (!editor.isEditable || blocks.length === 0 || !blocks.every(supportsTextSize)) return null;
  const current = String(styles.textSize ?? '');
  return (
    <Components.FormattingToolbar.Select
      className="bn-select nb-textsize-select"
      portalElement={portal}
      items={TEXT_SIZES.map((t) => ({
        text: t.label,
        icon: <Icon name="textSize" size={t.iconSize} />,
        isSelected: current === t.value,
        onClick: () => {
          editor.focus();
          if (t.value) editor.addStyles({ textSize: t.value });
          else editor.removeStyles({ textSize: '' });
        },
      }))}
    />
  );
}

/** Liste « largeur » de la barre de mise en forme quand une image ou une vidéo est sélectionnée. */
export function MediaWidthSelect() {
  const Components = useComponentsContext()!;
  const editor = useBlockNoteEditor() as AnyEditor;
  const portal = usePortalElement();
  const blocks = useSelectedBlocks(editor) as LooseBlock[];
  if (!editor.isEditable || blocks.length !== 1) return null;
  const block = blocks[0];
  if (!PREVIEW_WIDTH_BLOCKS.has(block.type) || !block.props.url) return null;
  const current = nearestPreset(blockWidthPercent(editor, block));
  return (
    <Components.FormattingToolbar.Select
      className="bn-select nb-width-select"
      portalElement={portal}
      items={WIDTH_PRESETS.map((pct) => ({
        text: pct === 100 ? 'Pleine largeur' : `Largeur ${pct} %`,
        icon: <Icon name="resize" size={14} />,
        isSelected: current === pct,
        onClick: () => applyBlockWidth(editor, block, pct),
      }))}
    />
  );
}
