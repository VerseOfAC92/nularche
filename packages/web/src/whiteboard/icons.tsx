// Tabula araç simgeleri: tek tip çizgi simgeler (temanın yazı rengini alır).

const P: Record<string, string> = {
  select: "M5 3l12 8.5-5.2 1.1L15 19l-2.4 1.1-3.2-6.4L5 17.3z",
  hand: "M8 11V5.5a1.5 1.5 0 013 0V10m0-.5V4.5a1.5 1.5 0 013 0V10m0-4a1.5 1.5 0 013 0v7.5c0 4-2.5 6.5-6 6.5-2.7 0-4.3-1.3-5.6-3.4L4.3 13.8a1.5 1.5 0 012.5-1.6L8 14",
  pen: "M4 20l1.2-4.6L15.6 5a2 2 0 012.8 0l.6.6a2 2 0 010 2.8L8.6 18.8zM13.5 7l3.5 3.5",
  pencil: "M4 20l1-4L16 5l3 3L8 19zM14 7l3 3M4 20l3-1",
  marker: "M6 21h12M8.5 16.5L5 20h4.5l1.5-1.5M8.5 16.5l2.5 2.5M8.5 16.5l9-9a2.1 2.1 0 00-3-3l-9 9 3 3",
  highlighter: "M4 21h16M9 17l-3 3h4l1.5-1.5M9 17l3.5 1.5M9 17l-1.5-3.5 8-8 5 5-8 8",
  eraser: "M8.5 20H20M4.6 15.6l9.8-9.8a2 2 0 012.8 0l2.5 2.5a2 2 0 010 2.8L11 20H8.5l-3.9-3.9a.3.3 0 010-.5zM9 11l5 5",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  sticky: "M5 4h14v10l-6 6H5zM13 20v-6h6",
  line: "M5 19L19 5",
  arrow: "M5 12h13M13 6l6 6-6 6",
  connector: "M5 5h6v14h8M16 16l3 3-3 3",
  table: "M4 5h16v14H4zM4 10h16M4 15h16M10 5v14",
  image: "M4 5h16v14H4zM4 16l5-5 4 4 2-2 5 5M15 9.5a1.5 1.5 0 100-.01",
  link: "M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1",
  undo: "M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3",
  redo: "M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3",
  more: "M6 12h.01M12 12h.01M18 12h.01",
};

export function ToolIcon({ name }: { name: keyof typeof P | string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "more" ? 3 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={P[name] ?? ""} />
    </svg>
  );
}
