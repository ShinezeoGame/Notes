import { useEffect } from 'react';
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
import { fr } from '@blocknote/core/locales';
import type { DocHandle } from '../lib/yjs';
import { useSettings } from '../lib/settings';
import { schema } from './schema';
import { useAppCtx } from './context';
import { Icon } from '../icons/Icon';
import type { IconName } from '../icons/registry';
import { MediaWidthSelect, NotesDragHandleMenu, TextSizeSelect } from './SizeControls';

type Props = { handle: DocHandle; editable: boolean };

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

  const editor = useCreateBlockNote(
    withCollaboration({
      schema,
      dictionary: fr,
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
      item.title === fr.slash_menu.image.title ? { ...item, aliases: [...(item.aliases ?? []), 'gif', 'giphy'] } : item,
    );
    const pageItems: DefaultReactSuggestionItem[] = [];
    if (ctx.createSubpage) {
      pageItems.push({
        title: 'Sous-page',
        subtext: 'Créer une nouvelle page à l’intérieur de celle-ci',
        aliases: ['page', 'sous-page', 'souspage', 'subpage', 'nouvelle page'],
        group: 'Pages',
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
        subtext: 'Importer un document PDF avec aperçu',
        aliases: ['pdf', 'document', 'fichier pdf'],
        group: fr.slash_menu.image.group,
        icon: <SlashIcon name="filePdf" />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'pdf' }),
      },
      {
        title: 'Vidéo YouTube / intégration',
        subtext: 'YouTube, Vimeo, Google Agenda, Drive, Figma…',
        aliases: ['youtube', 'embed', 'intégration', 'integration', 'iframe', 'vimeo', 'lien'],
        group: fr.slash_menu.image.group,
        icon: <SlashIcon name="video" />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'embed' }),
      },
      {
        title: 'GIF',
        subtext: 'Importer une image animée',
        aliases: ['gif', 'giphy', 'animation'],
        group: fr.slash_menu.image.group,
        icon: <SlashIcon name="image" />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'image' }),
      },
      {
        title: 'Agenda Google',
        subtext: 'Importer des événements (.ics, lien iCal ou compte Google)',
        aliases: ['agenda', 'calendar', 'calendrier', 'google', 'ics', 'événements', 'evenements'],
        group: fr.slash_menu.image.group,
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
    if (ctx.mode === 'owner') {
      mediaItems.push({
        title: 'Homelab',
        subtext: 'Intégrer le tableau de bord de vos applications et appareils',
        aliases: ['homelab', 'dashboard', 'tableau de bord', 'serveur', 'nas'],
        group: fr.slash_menu.image.group,
        icon: <SlashIcon name="home" />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'homelab' }),
      });
      mediaItems.push({
        title: 'Maison',
        subtext: 'Lumières, prises, volets, chauffage et caméras (Home Assistant)',
        aliases: ['maison', 'domotique', 'home assistant', 'lumière', 'lampe', 'ampoule', 'caméra', 'prise', 'volet', 'chauffage'],
        group: fr.slash_menu.image.group,
        icon: <SlashIcon name="bulb" />,
        onItemClick: () => insertOrUpdateBlockForSlashMenu(editor, { type: 'smarthome' }),
      });
    }
    return filterSuggestionItems([...pageItems, ...defaults, ...mediaItems], query);
  };

  return (
    <BlockNoteView editor={editor} theme="dark" editable={editable} slashMenu={false} formattingToolbar={false} sideMenu={false} className="nb-editor">
      <SuggestionMenuController triggerCharacter="/" getItems={getItems} />
      <FormattingToolbarController formattingToolbar={NotesFormattingToolbar} />
      <SideMenuController sideMenu={(props) => <SideMenu {...props} dragHandleMenu={NotesDragHandleMenu} />} />
    </BlockNoteView>
  );
}

/** Barre de mise en forme par défaut, complétée par la taille du texte et la largeur des images. */
function NotesFormattingToolbar() {
  const items = getFormattingToolbarItems();
  items.splice(1, 0, <TextSizeSelect key="nbTextSizeSelect" />, <MediaWidthSelect key="nbMediaWidthSelect" />);
  return <FormattingToolbar>{items}</FormattingToolbar>;
}
