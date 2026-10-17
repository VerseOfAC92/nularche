// Sayfaya gömülü (satır içi) veritabanı bloğu. Markdown'da tek satır: `@[database](Gorevler/Gorevler.md#view=v_board)`.
// Hedef, göreli bir Markdown bağlantısı olduğundan Node taşınınca/yeniden adlandırılınca diğer bağlantılar gibi güncellenir.

import { mergeAttributes, Node, type MarkdownToken } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { createContext, useContext } from "react";
import type { NodeMeta } from "../api.ts";
import { vaultPathFromUrl } from "../editor/paths.ts";
import { t } from "../i18n/index.ts";
import { DatabaseView } from "./DatabaseView.tsx";

export interface DatabaseHost {
  nodes: NodeMeta[];
  onChanged: () => void;
  onNavigate: (id: string) => void;
  onToast: (msg: string) => void;
}

/** Gömülü veritabanlarının Node listesine ve uygulama geri çağrılarına erişimi (NodeView sağlar). */
export const DatabaseHostContext = createContext<DatabaseHost | null>(null);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    inlineDatabase: {
      insertDatabase: (src: string) => ReturnType;
    };
  }
}

function splitSrc(src: string): { path: string | null; view?: string } {
  const [base, hash = ""] = src.split("#");
  const view = /(?:^|&)view=([^&]+)/.exec(hash)?.[1];
  return { path: vaultPathFromUrl(base), view: view ? decodeURIComponent(view) : undefined };
}

function InlineDatabaseView({ node, updateAttributes, selected }: NodeViewProps) {
  const host = useContext(DatabaseHostContext);
  const src = String(node.attrs.src ?? "");
  const { path, view } = splitSrc(src);
  const dbNode = host?.nodes.find((n) => n.path === path);
  return (
    <NodeViewWrapper className={`inline-db ${selected ? "selected" : ""}`} contentEditable={false} data-drag-handle="">
      {!host || !dbNode?.database ? (
        <div className="db-empty">{t("db.inlineMissing")}</div>
      ) : (
        <DatabaseView
          dbNode={dbNode}
          nodes={host.nodes}
          inline
          viewId={view && dbNode.database ? view : undefined}
          onSelectView={(id) => updateAttributes({ src: `${src.split("#")[0]}#view=${encodeURIComponent(id)}` })}
          onChanged={host.onChanged}
          onNavigate={host.onNavigate}
          onToast={host.onToast}
        />
      )}
    </NodeViewWrapper>
  );
}

export const InlineDatabase = Node.create({
  name: "inlineDatabase",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { src: { default: "" } };
  },
  parseHTML() {
    return [{ tag: "div[data-inline-database]" }];
  },
  renderHTML({ HTMLAttributes }) {
    return ["div", mergeAttributes(HTMLAttributes, { "data-inline-database": "" })];
  },
  addNodeView() {
    return ReactNodeViewRenderer(InlineDatabaseView, { stopEvent: () => true });
  },
  addCommands() {
    return {
      insertDatabase:
        (src: string) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs: { src } }),
    };
  },
  markdownTokenizer: {
    name: "inlineDatabase",
    level: "block",
    start: (src: string) => src.indexOf("@[database]("),
    tokenize(src: string) {
      const m = /^@\[database\]\(([^)\s]+)\)[ \t]*(?:\n|$)/.exec(src);
      return m ? { type: "inlineDatabase", raw: m[0], src: m[1] } : undefined;
    },
  },
  parseMarkdown: (token: MarkdownToken, h: any) => h.createNode("inlineDatabase", { src: (token as { src?: string }).src }),
  renderMarkdown: (node: { attrs?: Record<string, unknown> }) => `@[database](${String(node.attrs?.src ?? "")})`,
});
