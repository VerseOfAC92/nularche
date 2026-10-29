// Ses kaydı ve çizim blokları. Markdown'da tek satır: `@[audio](Attachments/kayit.webm)`, `@[drawing](Attachments/cizim.png)`.
// Dosyalar `Attachments/` klasöründedir; bağlantı biçimi gömülü veritabanıyla aynı olduğu için not taşınınca güncellenir.

import { mergeAttributes, Node, type MarkdownToken } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { createContext, useContext, useState } from "react";
import { t } from "../i18n/index.ts";

export interface MediaHost {
  /** Ses dosyasını yazıya döker ya da özetler; Markdown metni döndürür (vazgeçilir ya da yapılamazsa null). */
  transcribe: (src: string, mode: "transcript" | "summary") => Promise<string | null>;
  /** Çizim düzenleyicisini açar; kaydedilirse yeni dosyanın editör adresini döndürür. */
  editDrawing: (src: string | null) => Promise<string | null>;
}

/** NodeView sağlar; editör testlerinde yoktur. */
export const MediaHostContext = createContext<MediaHost | null>(null);

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    mediaBlocks: {
      insertAudio: (src: string) => ReturnType;
      insertDrawing: (src: string) => ReturnType;
    };
  }
}

function AudioView({ node, editor, getPos, selected }: NodeViewProps) {
  const host = useContext(MediaHostContext);
  const [busy, setBusy] = useState<"transcript" | "summary" | null>(null);
  const src = String(node.attrs.src ?? "");
  const name = decodeURIComponent(src.split("/").pop() ?? "");
  const run = async (mode: "transcript" | "summary") => {
    if (!host) return;
    setBusy(mode);
    try {
      const md = await host.transcribe(src, mode);
      const pos = typeof getPos === "function" ? getPos() : undefined;
      if (md && pos !== undefined) editor.chain().focus().insertContentAt(pos + node.nodeSize, md, { contentType: "markdown" } as never).run();
    } finally {
      setBusy(null);
    }
  };
  return (
    <NodeViewWrapper className={`media-block audio-block ${selected ? "selected" : ""}`} contentEditable={false} data-drag-handle="">
      <div className="media-head">
        <span>🎙 {name}</span>
        {host && (
          <span className="media-actions">
            <button disabled={!!busy} onClick={() => run("transcript")}>
              {busy === "transcript" ? "…" : t("media.transcribe")}
            </button>
            <button disabled={!!busy} onClick={() => run("summary")}>
              {busy === "summary" ? "…" : t("media.summarize")}
            </button>
          </span>
        )}
      </div>
      <audio controls preload="metadata" src={src} />
    </NodeViewWrapper>
  );
}

function DrawingView({ node, updateAttributes, selected }: NodeViewProps) {
  const host = useContext(MediaHostContext);
  const src = String(node.attrs.src ?? "");
  const edit = async () => {
    const next = await host?.editDrawing(src);
    if (next) updateAttributes({ src: next });
  };
  return (
    <NodeViewWrapper className={`media-block drawing-block ${selected ? "selected" : ""}`} contentEditable={false} data-drag-handle="">
      <img src={src} alt="" onDoubleClick={edit} draggable={false} />
      {host && (
        <button className="drawing-edit" onClick={edit}>
          ✎ {t("media.editDrawing")}
        </button>
      )}
    </NodeViewWrapper>
  );
}

function mediaNode(name: "audio" | "drawing", view: (p: NodeViewProps) => React.ReactNode) {
  const type = name === "audio" ? "audioBlock" : "drawingBlock";
  const prefix = `@[${name}](`;
  return Node.create({
    name: type,
    group: "block",
    atom: true,
    draggable: true,
    selectable: true,
    addAttributes() {
      return { src: { default: "" } };
    },
    parseHTML() {
      return [{ tag: `div[data-${name}]`, getAttrs: (el) => ({ src: (el as HTMLElement).getAttribute("data-src") ?? "" }) }];
    },
    renderHTML({ HTMLAttributes }) {
      return ["div", mergeAttributes({ [`data-${name}`]: "", "data-src": HTMLAttributes.src })];
    },
    addNodeView() {
      return ReactNodeViewRenderer(view, { stopEvent: () => true });
    },
    addCommands() {
      const cmd =
        (src: string) =>
        ({ commands }: { commands: { insertContent: (c: unknown) => boolean } }) =>
          commands.insertContent({ type: type, attrs: { src } });
      return (name === "audio" ? { insertAudio: cmd } : { insertDrawing: cmd }) as never;
    },
    markdownTokenizer: {
      name: type,
      level: "block",
      start: (src: string) => src.indexOf(prefix),
      tokenize(src: string) {
        const m = new RegExp(`^@\\[${name}\\]\\(([^)\\s]+)\\)[ \\t]*(?:\\n|$)`).exec(src);
        return m ? { type, raw: m[0], src: m[1] } : undefined;
      },
    },
    parseMarkdown: (token: MarkdownToken, h: any) => h.createNode(type, { src: (token as { src?: string }).src }),
    renderMarkdown: (node: { attrs?: Record<string, unknown> }) => `${prefix}${String(node.attrs?.src ?? "")})`,
  });
}

export const AudioBlock = mediaNode("audio", AudioView);
export const DrawingBlock = mediaNode("drawing", DrawingView);
