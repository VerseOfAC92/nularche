// Editörün Shard (blok) türleri: hem uygulama hem gidiş-dönüş testleri bu listeyi kullanır.

import type { Extensions } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Color } from "@tiptap/extension-text-style";
import { Focus, Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { Callout, MdDetails, MdDetailsContent, MdDetailsSummary, MdTextStyle, MdYoutube } from "./markdown-extensions.ts";
import { t } from "../i18n/index.ts";
import { InlineDatabase } from "../database/InlineDatabase.tsx";
import { AudioBlock, DrawingBlock } from "./media-nodes.tsx";
import { FootnoteDef, FootnoteRef, MathBlock, MathInline, ObsidianTools, WikiLink } from "./obsidian-nodes.tsx";
import {
  BlockStyle,
  DashedBulletList,
  FindReplace,
  HeadingFold,
  MathResults,
  MdHeading,
  MdParagraph,
  Subscript,
  Superscript,
  TagHighlight,
  TaskTools,
} from "./notes-extensions.ts";

export const lowlight = createLowlight(common);

export function buildExtensions(options: { placeholder?: string } = {}): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      paragraph: false,
      heading: false,
      bulletList: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
    }),
    MdParagraph,
    MdHeading,
    DashedBulletList,
    BlockStyle,
    Superscript,
    Subscript,
    CodeBlockLowlight.configure({ lowlight }),
    TaskList,
    TaskItem.configure({ nested: true }),
    TableKit.configure({ table: { resizable: true } }),
    Image.configure({ inline: false }),
    Highlight,
    MdTextStyle,
    Color,
    Callout,
    MdDetails.configure({ persist: true }),
    MdDetailsSummary,
    MdDetailsContent,
    MdYoutube.configure({ nocookie: true }),
    InlineDatabase,
    AudioBlock,
    DrawingBlock,
    WikiLink,
    FootnoteRef,
    FootnoteDef,
    MathInline,
    MathBlock,
    ObsidianTools,
    TagHighlight,
    HeadingFold,
    FindReplace,
    TaskTools,
    MathResults,
    Focus.configure({ className: "has-focus", mode: "shallowest" }),
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ node }) => (node.type.name === "detailsSummary" ? t("ed.summaryPlaceholder") : (options.placeholder ?? "")),
    }),
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}
