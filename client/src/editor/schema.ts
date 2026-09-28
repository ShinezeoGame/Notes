import { BlockNoteSchema, defaultBlockSpecs } from '@blocknote/core';
import { PageLinkBlock } from './blocks/PageLinkBlock';
import { PdfBlock } from './blocks/PdfBlock';
import { EmbedBlock } from './blocks/EmbedBlock';
import { CalendarBlock } from './blocks/CalendarBlock';
import { HomelabBlock } from './blocks/HomelabBlock';

export const schema = BlockNoteSchema.create({
  blockSpecs: {
    ...defaultBlockSpecs,
    pageLink: PageLinkBlock(),
    pdf: PdfBlock(),
    embed: EmbedBlock(),
    calendar: CalendarBlock(),
    homelab: HomelabBlock(),
  },
});

export type NotesEditor = typeof schema.BlockNoteEditor;
export type NotesBlock = typeof schema.Block;
