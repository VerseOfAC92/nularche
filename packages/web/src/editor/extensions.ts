// Editörün Shard (blok) türleri: hem uygulama hem gidiş-dönüş testleri bu listeyi kullanır.

import type { Extensions } from "@tiptap/core";
import { CodeBlockLowlight } from "@tiptap/extension-code-block-lowlight";
import { Highlight } from "@tiptap/extension-highlight";
import { Image } from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { TaskItem, TaskList } from "@tiptap/extension-list";
import { Color } from "@tiptap/extension-text-style";
import { Placeholder } from "@tiptap/extensions";
import { Markdown } from "@tiptap/markdown";
import StarterKit from "@tiptap/starter-kit";
import { common, createLowlight } from "lowlight";
import { Callout, MdDetails, MdDetailsContent, MdDetailsSummary, MdTextStyle, MdYoutube } from "./markdown-extensions.ts";
import { t } from "../i18n/index.ts";
import { InlineDatabase } from "../database/InlineDatabase.tsx";

export const lowlight = createLowlight(common);

export function buildExtensions(options: { placeholder?: string } = {}): Extensions {
  return [
    StarterKit.configure({
      codeBlock: false,
      link: { openOnClick: false, autolink: true, linkOnPaste: true },
    }),
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
    Placeholder.configure({
      includeChildren: true,
      placeholder: ({ node }) => (node.type.name === "detailsSummary" ? t("ed.summaryPlaceholder") : (options.placeholder ?? "")),
    }),
    Markdown.configure({ markedOptions: { gfm: true } }),
  ];
}
