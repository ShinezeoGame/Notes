import { BlockNoteSchema, defaultBlockSpecs, defaultStyleSpecs } from '@blocknote/core';
import { PageLinkBlock } from './blocks/PageLinkBlock';
import { PdfBlock } from './blocks/PdfBlock';
import { EmbedBlock } from './blocks/EmbedBlock';
import { CalendarBlock } from './blocks/CalendarBlock';
import { HomelabBlock } from './blocks/HomelabBlock';
import { SmartHomeBlock } from './blocks/SmartHomeBlock';
import { TextSizeStyle } from './styles/TextSize';
import { columnBlockSpecs } from './columns';

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    ...columnBlockSpecs,
    pageLink: PageLinkBlock(),
    pdf: PdfBlock(),
    embed: EmbedBlock(),
    calendar: CalendarBlock(),
    homelab: HomelabBlock(),
    smarthome: SmartHomeBlock(),
  },
  styleSpecs: {
    ...defaultStyleSpecs,
    textSize: TextSizeStyle,
  },
});

export type NotesEditor = typeof schema.BlockNoteEditor;
export type NotesBlock = typeof schema.Block;
