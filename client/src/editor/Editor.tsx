import { useEffect, useState } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import {
  FormattingToolbar,
  FormattingToolbarController,
  SideMenu,
  SideMenuController,
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  getFormattingToolbarItems,
  useCreateBlockNote,
  useEditorChange,
  type DefaultReactSuggestionItem,
} from '@blocknote/react';
import { filterSuggestionItems, insertOrUpdateBlockForSlashMenu } from '@blocknote/core/extensions';
import { withCollaboration } from '@blocknote/core/yjs';
import { en, fr } from '@blocknote/core/locales';
import type { DocHandle } from '../lib/yjs';
import { getSettings, useSettings } from '../lib/settings';
import { schema } from './schema';
import { PageDocContext, useAppCtx } from './context';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';
import { MediaWidthSelect, NotesDragHandleMenu, TextSizeSelect } from './SizeControls';
import { ImageCropButton, ImageCropContext, NoteImageCrop, type ImageCropRequest } from './ImageCrop';
import { columnsDropCursor, insertColumns } from './columns';
import { yjsSelectionGuard } from './yjsSelectionGuard';
import { useThemeBase } from '../lib/appearance';
import { t, getLang } from '../lib/i18n';

type Props = { handle: DocHandle; editable: boolean };

/** Textes de BlockNote (menus, barre d'outils) dans la langue de l'interface. */
const DICTIONARY = getLang() === 'fr' ? fr : en;

const SlashIcon = ({ name }: { name: IconName }) => (
  <span className="nb-slash-icon">
    <Icon name={name} size={18} />
  </span>
);

type LooseBlock = { id: string; type: string; props: Record<string, unknown>; children?: LooseBlock[] };

function isPdfFile(props: Record<string, unknown>): boolean {
  const url = String(props.url ?? '');
  const name = String(props.name ?? '');
  if (!url) return false;
  return /\.pdf($|[?#])/i.test(url) || /^data:application\/pdf/i.test(url) || /\.pdf$/i.test(name);
}

export function Editor({ handle, editable }: Props) {
  const ctx = useAppCtx();
  const settings = useSettings();
  // Image de la page en cours de recadrage (bouton « Recadrer » de la barre de mise en forme).
  const [imageCrop, setImageCrop] = useState<ImageCropRequest | null>(null);

  const themeBase = useThemeBase();
  const editor = useCreateBlockNote(
    withCollaboration({
      schema,
      dictionary: DICTIONARY,
      // Barre verticale quand un bloc glissé vise le bord d'un autre : ils se placeront côte à côte.
      dropCursor: columnsDropCursor,
      // Annulation (Ctrl+Z) sûre après le déplacement d'un module : voir yjsSelectionGuard.
      extensions: [yjsSelectionGuard()],
      uploadFile: (file: File) => ctx.uploadFile(file),
      tables: { splitCells: true, cellBackgroundColor: true, cellTextColor: true, headers: true },
      collaboration: {
        fragment: handle.doc.getXmlFragment('content'),
        user: { name: settings.userName, color: settings.userColor },
        provider: handle.provider ?? undefined,
        showCursorLabels: 'activity',
      },
    }),
    [handle],
  );

  // Met à jour le nom/la couleur du curseur collaboratif quand l'utilisateur change ses réglages.
  useEffect(() => {
    try {
      const ext = editor.getExtension('yCursor') as unknown as
        | { updateUser?: (u: { name: string; color: string }) => void }
        | undefined;
      ext?.updateUser?.({ name: settings.userName, color: settings.userColor });
    } catch {
      /* extension absente */
    }
  }, [editor, settings.userName, settings.userColor]);

  // Un fichier PDF déposé via le bloc "Fichier" générique devient un bloc PDF avec aperçu.
  useEditorChange((ed) => {
    if (!editable) return;
    const visit = (blocks: LooseBlock[]): boolean => {
      for (const b of blocks) {
        if (b.type === 'file' && isPdfFile(b.props)) {
          ed.updateBlock(b.id, {
            type: 'pdf',
            props: { url: String(b.props.url), name: String(b.props.name ?? ''), caption: String(b.props.caption ?? '') },
          } as never);
          return true;
        }
        if (b.children?.length && visit(b.children)) return true;
      }
      return false;
    };
    visit(ed.document as unknown as LooseBlock[]);
  }, editor);

  const getItems = async (query: string) => {
    const defaults = getDefaultReactSlashMenuItems(editor).map((item) =>
      item.title === DICTIONARY.slash_menu.image.title ? { ...item, aliases: [...(item.aliases ?? []), 'gif', 'giphy'] } : item,
    );
    // Tableur (façon Excel) juste avant le tableau simple : « /tableau » le propose en premier.
    const sheetItem: DefaultReactSuggestionItem = {
      title: t('Tableur'),
      subtext: t('Feuille de calcul façon Excel : formules, import et export .xlsx'),
      aliases: [
        'tableau',
        'tableur',
        'excel',
        'xlsx',
        'csv',
        'feuille de calcul',
        'calcul',
        'formule',
        'spreadsheet',
        'sheet',
        'calc',
        'formula',
        'table',
      ],
      group: DICTIONARY.slash_menu.table.group,
      icon: <SlashIcon name="table" />,
      onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'spreadsheet' }),
    };
    const tableAt = defaults.findIndex((item) => item.title === DICTIONARY.slash_menu.table.title);
    defaults.splice(tableAt < 0 ? defaults.length : tableAt, 0, sheetItem);
    const pageItems: DefaultReactSuggestionItem[] = [];
    if (ctx.createSubpage) {
      pageItems.push({
        title: t('Sous-page'),
        subtext: t('Créer une nouvelle page à l’intérieur de celle-ci'),
        aliases: ['page', 'sous-page', 'souspage', 'subpage', 'nouvelle page', 'new page'],
        group: t('Pages'),
        icon: <SlashIcon name="file" />,
        onItemClick: () => {
          void (async () => {
            const id = await ctx.createSubpage!(ctx.currentPageId, '');
            if (id) insertOrUpdateBlockForSlashMenu(editor, { type: 'pageLink', props: { pageId: id } });
          })();
        },
      });
    }
    const mediaItems: DefaultReactSuggestionItem[] = [
      {
        title: 'PDF',
        subtext: t('Importer un document PDF avec aperçu'),
        aliases: ['pdf', 'document', 'fichier pdf', 'pdf file'],
        group: DICTIONARY.slash_menu.image.group,
        icon: <SlashIcon name="filePdf" />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'pdf' }),
      },
      {
        title: t('Vidéo YouTube / intégration'),
        subtext: t('YouTube, Vimeo, Google Agenda, Drive, Figma…'),
        aliases: ['youtube', 'embed', 'intégration', 'integration', 'iframe', 'vimeo', 'lien', 'link', 'video'],
        group: DICTIONARY.slash_menu.image.group,
        icon: <SlashIcon name="video" />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'embed' }),
      },
      {
        title: 'GIF',
        subtext: t('Importer une image animée'),
        aliases: ['gif', 'giphy', 'animation'],
        group: DICTIONARY.slash_menu.image.group,
        icon: <SlashIcon name="image" />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'image' }),
      },
      {
        title: t('Agenda Google'),
        subtext: t('Importer des événements (.ics, lien iCal ou compte Google)'),
        aliases: ['agenda', 'calendar', 'calendrier', 'google', 'ics', 'événements', 'evenements', 'events'],
        group: DICTIONARY.slash_menu.image.group,
        icon: <SlashIcon name="calendar" />,
        onItemClick: () => {
          void (async () => {
            const res = await ctx.importCalendar();
            if (res) {
              insertOrUpdateBlockForSlashMenu(editor, {
                type: 'calendar',
                props: { title: res.title, events: JSON.stringify(res.events), source: res.source, updatedAt: Date.now() },
              });
            }
          })();
        },
      },
    ];
    // Modules reliés au réseau du serveur : ni pour les invités d'un lien, ni pour un espace créé par une invitation.
    if (ctx.mode === 'owner' && !getSettings().guest) {
      mediaItems.push({
        title: 'Homelab',
        subtext: t('Intégrer le tableau de bord de vos applications et appareils'),
        aliases: ['homelab', 'dashboard', 'tableau de bord', 'serveur', 'server', 'nas'],
        group: DICTIONARY.slash_menu.image.group,
        icon: <SlashIcon name="home" />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'homelab' }),
      });
      mediaItems.push({
        title: t('Maison'),
        subtext: t('Lumières, prises, volets, chauffage et caméras (Home Assistant)'),
        aliases: [
          'maison',
          'domotique',
          'home assistant',
          'lumière',
          'lampe',
          'ampoule',
          'prise',
          'volet',
          'chauffage',
          'home',
          'smart home',
          'light',
          'lamp',
          'plug',
          'blind',
          'heating',
        ],
        group: DICTIONARY.slash_menu.image.group,
        icon: <SlashIcon name="bulb" />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'smarthome' }),
      });
      mediaItems.push({
        title: t('Caméra'),
        subtext: t('Direct d’une caméra de surveillance (ou de toutes)'),
        aliases: [
          'caméra',
          'camera',
          'caméras',
          'cameras',
          'surveillance',
          'vidéosurveillance',
          'videosurveillance',
          'cctv',
          'rtsp',
          'flux vidéo',
          'direct',
          'live',
        ],
        group: DICTIONARY.slash_menu.image.group,
        icon: <SlashIcon name="cctv" />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'camera' }),
      });
    }
    const layoutItems: DefaultReactSuggestionItem[] = [2, 3].map((n) => ({
      title: t('{n} colonnes', { n }),
      subtext: n === 2 ? t('Deux blocs côte à côte (texte, image, vidéo, module…)') : t('Trois blocs côte à côte'),
      aliases: ['colonnes', 'colonne', 'columns', 'column', 'côte à côte', 'cote a cote', 'side by side', 'mise en page', 'layout'],
      group: t('Mise en page'),
      icon: <SlashIcon name={n === 2 ? 'columns2' : 'columns3'} />,
      onItemClick: () => insertColumns(editor, n),
    }));
    return filterSuggestionItems([...pageItems, ...defaults, ...mediaItems, ...layoutItems], query);
  };

  return (
    <ImageCropContext.Provider value={setImageCrop}>
      <PageDocContext.Provider value={handle.doc}>
        <BlockNoteView
          editor={editor}
          theme={themeBase}
          editable={editable}
          slashMenu={false}
          formattingToolbar={false}
          sideMenu={false}
          className="nb-editor"
        >
          <SuggestionMenuController triggerCharacter="/" getItems={getItems} />
          <FormattingToolbarController formattingToolbar={NotesFormattingToolbar} />
          <SideMenuController sideMenu={(props) => <SideMenu {...props} dragHandleMenu={NotesDragHandleMenu} />} />
        </BlockNoteView>
      </PageDocContext.Provider>
      {imageCrop ? <NoteImageCrop editor={editor} req={imageCrop} upload={ctx.uploadFile} onClose={() => setImageCrop(null)} /> : null}
    </ImageCropContext.Provider>
  );
}

/** Barre de mise en forme par défaut, complétée par la taille du texte, la largeur et le recadrage des images. */
function NotesFormattingToolbar() {
  const items = getFormattingToolbarItems();
  items.splice(1, 0, <TextSizeSelect key="nbTextSizeSelect" />, <MediaWidthSelect key="nbMediaWidthSelect" />, <ImageCropButton key="nbImageCropButton" />);
  return <FormattingToolbar>{items}</FormattingToolbar>;
}
