import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { makeId, type NoteBlock, type NoteBlockType } from "../data/types";

type Props = {
  blocks: NoteBlock[];
  onChange: (blocks: NoteBlock[]) => void;
};

const labels: Array<[NoteBlockType, string]> = [
  ["paragraph", "文字"],
  ["heading", "標題"],
  ["bulletList", "符號列表"],
  ["numberList", "編號列表"],
  ["checkList", "待辦列表"],
  ["quote", "引言"],
  ["table", "表格"],
  ["divider", "分隔線"],
];

function DrawingPad({ onClose, onSave }: { onClose: () => void; onSave: (dataUrl: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [color, setColor] = useState("#5d4b86");
  const [width, setWidth] = useState(4);
  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#fffdf8";
    context.fillRect(0, 0, canvas.width, canvas.height);
  }, []);
  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const bounds = canvas.getBoundingClientRect();
    return { x: ((event.clientX - bounds.left) * canvas.width) / bounds.width, y: ((event.clientY - bounds.top) * canvas.height) / bounds.height };
  };
  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    const context = event.currentTarget.getContext("2d")!;
    const position = point(event);
    context.beginPath();
    context.moveTo(position.x, position.y);
  };
  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d")!;
    const position = point(event);
    context.strokeStyle = color;
    context.lineWidth = width;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineTo(position.x, position.y);
    context.stroke();
  };
  return (
    <div className="modal-layer" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal drawing-modal" role="dialog" aria-label="簡易畫筆">
        <header><div><small>SKETCH</small><h2>簡易畫筆</h2></div><button aria-label="關閉" className="close" onClick={onClose}>×</button></header>
        <div className="drawing-tools">
          <label>顏色 <input type="color" value={color} onChange={(event) => setColor(event.target.value)} /></label>
          <label>粗細 <input type="range" min="1" max="18" value={width} onChange={(event) => setWidth(Number(event.target.value))} /></label>
          <button onClick={() => { const canvas = canvasRef.current!; const context = canvas.getContext("2d")!; context.fillStyle = "#fffdf8"; context.fillRect(0, 0, canvas.width, canvas.height); }}>清除</button>
        </div>
        <canvas ref={canvasRef} width="900" height="520" onPointerDown={start} onPointerMove={move} onPointerUp={() => (drawing.current = false)} onPointerCancel={() => (drawing.current = false)} />
        <footer><span>畫筆內容會插入目前筆記</span><button onClick={() => onSave(canvasRef.current!.toDataURL("image/png"))}>插入筆記</button></footer>
      </section>
    </div>
  );
}

const createBlock = (type: NoteBlockType): NoteBlock => ({
  id: makeId("block"), type, content: "",
  ...(type === "table" ? { rows: 3, columns: 3, cells: Array(9).fill("") } : {}),
});

export default function NoteCanvas({ blocks, onChange }: Props) {
  const [drawing, setDrawing] = useState(false);
  const [drawingIndex, setDrawingIndex] = useState<number | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);
  const blockDrag = useRef<{ id: string; startX: number; startY: number; moved: boolean; overId?: string } | null>(null);
  const [dragView, setDragView] = useState<{ id: string; overId?: string } | null>(null);
  const update = (id: string, patch: Partial<NoteBlock>) => onChange(blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  const insert = (block: NoteBlock) => onChange([...blocks, block]);
  const insertAt = (index: number, block: NoteBlock) => {
    const next = [...blocks];
    next.splice(index, 0, block);
    onChange(next);
  };
  const chooseImage = (event: ChangeEvent<HTMLInputElement>, index = blocks.length) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { alert("圖片請小於 12 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => insertAt(index, { id: makeId("block"), type: "image", dataUrl: String(reader.result), width: 70 });
    reader.readAsDataURL(file);
    event.target.value = "";
  };
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const escape = (event: KeyboardEvent) => event.key === "Escape" && close();
    window.addEventListener("keydown", escape);
    return () => {
      window.removeEventListener("keydown", escape);
    };
  }, [menu]);
  const reorderBlock = (fromId: string, targetId: string) => {
    if (!fromId || fromId === targetId) return;
    const next = [...blocks];
    const from = next.findIndex((item) => item.id === fromId), to = next.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };
  const startBlockDrag = (id: string, event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    blockDrag.current = { id, startX: event.clientX, startY: event.clientY, moved: false };
    setDragView({ id });
  };
  const moveBlockDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = blockDrag.current;
    if (!current) return;
    event.preventDefault();
    const target = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement | null;
    const overId = target?.closest<HTMLElement>("[data-block-sort]")?.dataset.blockSort;
    const next = { ...current, moved: current.moved || Math.hypot(event.clientX - current.startX, event.clientY - current.startY) > 4, overId };
    blockDrag.current = next;
    setDragView({ id: next.id, overId });
  };
  const endBlockDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const current = blockDrag.current;
    if (!current) return;
    event.preventDefault();
    event.stopPropagation();
    if (current.moved && current.overId) reorderBlock(current.id, current.overId);
    blockDrag.current = null;
    setDragView(null);
  };
  const openInsertMenu = (event: ReactMouseEvent<HTMLElement>, index: number) => {
    event.preventDefault();
    setMenu({ x: Math.min(event.clientX, innerWidth - 230), y: Math.min(event.clientY, innerHeight - 360), index });
  };
  return (
    <section className="block-editor" onContextMenu={(event) => {
      if ((event.target as HTMLElement).closest(".note-block")) return;
      const children = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-block-sort]")];
      const index = children.findIndex((child) => event.clientY < child.getBoundingClientRect().top + child.offsetHeight / 2);
      openInsertMenu(event, index < 0 ? blocks.length : index);
    }}>
      <p className="block-help">在任一區塊按右鍵，可直接在該處插入文字、列表、圖片或表格；區塊仍可拖曳排序。</p>
      <div className="note-blocks">
        {blocks.length === 0 && <button className="empty-block" onClick={() => insert(createBlock("paragraph"))}>開始書寫</button>}
        {blocks.map((block) => (
          <article data-block-sort={block.id} key={block.id} className={`note-block block-${block.type} ${dragView?.overId === block.id ? "drag-over" : ""}`} onContextMenu={(event) => openInsertMenu(event, blocks.findIndex((item) => item.id === block.id) + 1)}>
            <div className="block-side"><button type="button" className="block-drag-handle" title="按住拖曳排序" aria-label="拖曳區塊排序" onPointerDown={(event) => startBlockDrag(block.id, event)} onPointerMove={moveBlockDrag} onPointerUp={endBlockDrag} onPointerCancel={endBlockDrag}>⋮⋮</button><button aria-label="刪除區塊" onClick={() => onChange(blocks.filter((item) => item.id !== block.id))}>×</button></div>
            <BlockContent block={block} update={(patch) => update(block.id, patch)} />
          </article>
        ))}
      </div>
      {menu && (
        <><button className="block-context-backdrop" aria-label="關閉插入選單" onClick={() => setMenu(null)} />
        <div className="block-context-menu" style={{ left: menu.x, top: menu.y }} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
          <small>插入區塊</small>
          {labels.map(([type, label]) => <button key={type} type="button" onClick={() => { insertAt(menu.index, createBlock(type)); setMenu(null); }}>＋ {label}</button>)}
          <label>▧ 加入圖片<input hidden type="file" accept="image/*" onChange={(event) => { chooseImage(event, menu.index); setMenu(null); }} /></label>
          <button type="button" onClick={() => { setDrawingIndex(menu.index); setDrawing(true); setMenu(null); }}>✎ 簡易畫筆</button>
        </div></>
      )}
      {drawing && <DrawingPad onClose={() => { setDrawing(false); setDrawingIndex(null); }} onSave={(dataUrl) => { const block = { id: makeId("block"), type: "drawing" as const, dataUrl, width: 70 }; if (drawingIndex === null) insert(block); else insertAt(drawingIndex, block); setDrawing(false); setDrawingIndex(null); }} />}
    </section>
  );
}

function BlockContent({ block, update }: { block: NoteBlock; update: (patch: Partial<NoteBlock>) => void }) {
  if (block.type === "divider") return <hr />;
  if (block.type === "image" || block.type === "drawing") return <div className="inline-note-image"><img src={block.dataUrl} alt={block.type === "drawing" ? "手繪內容" : "筆記圖片"} style={{ width: `${block.width || 70}%` }} /><label>圖片寬度<input type="range" min="25" max="100" value={block.width || 70} onChange={(event) => update({ width: Number(event.target.value) })} /></label></div>;
  if (block.type === "table") {
    const rows = block.rows || 3, columns = block.columns || 3, cells = block.cells || Array(rows * columns).fill("");
    const resize = (nextRows: number, nextColumns: number) => {
      const next = Array(nextRows * nextColumns).fill("");
      for (let row = 0; row < Math.min(rows, nextRows); row++) for (let column = 0; column < Math.min(columns, nextColumns); column++) next[row * nextColumns + column] = cells[row * columns + column] || "";
      update({ rows: nextRows, columns: nextColumns, cells: next });
    };
    return <div className="note-table-wrap"><div className="table-size"><label>列 <input type="number" min="1" max="12" value={rows} onChange={(event) => resize(Number(event.target.value), columns)} /></label><label>欄 <input type="number" min="1" max="8" value={columns} onChange={(event) => resize(rows, Number(event.target.value))} /></label></div><div className="note-table" style={{ gridTemplateColumns: `repeat(${columns}, minmax(90px, 1fr))` }}>{cells.map((cell, index) => <input key={index} value={cell} onChange={(event) => { const next = [...cells]; next[index] = event.target.value; update({ cells: next }); }} />)}</div></div>;
  }
  if (block.type === "checkList") {
    const lines = (block.content || "").split("\n"), checked = block.checked || [];
    return <div className="check-block">{lines.map((line, index) => <label key={index}><input type="checkbox" checked={Boolean(checked[index])} onChange={(event) => { const next = [...checked]; next[index] = event.target.checked; update({ checked: next }); }} /><input value={line} placeholder="待辦項目" onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); const next = [...lines]; next.splice(index + 1, 0, ""); const nextChecked = [...checked]; nextChecked.splice(index + 1, 0, false); update({ content: next.join("\n"), checked: nextChecked }); requestAnimationFrame(() => (event.currentTarget.parentElement?.nextElementSibling?.querySelector("input:last-child") as HTMLInputElement | null)?.focus()); }} onChange={(event) => { const next = [...lines]; next[index] = event.target.value; update({ content: next.join("\n") }); }} /></label>)}</div>;
  }
  if (block.type === "bulletList" || block.type === "numberList") {
    const lines = (block.content || "").split("\n");
    return <div className="structured-list">{lines.map((line, index) => <label key={index}><b>{block.type === "bulletList" ? "•" : `${index + 1}.`}</b><input value={line} placeholder="列表項目" onKeyDown={(event) => { if (event.key !== "Enter") return; event.preventDefault(); const next = [...lines]; next.splice(index + 1, 0, ""); update({ content: next.join("\n") }); requestAnimationFrame(() => (event.currentTarget.parentElement?.nextElementSibling?.querySelector("input") as HTMLInputElement | null)?.focus()); }} onChange={(event) => { const next = [...lines]; next[index] = event.target.value; update({ content: next.join("\n") }); }} /></label>)}</div>;
  }
  const placeholder = block.type === "heading" ? "輸入標題" : block.type === "quote" ? "輸入引言" : "輸入文字……";
  return <textarea className="block-text" rows={block.type === "heading" ? 1 : 3} value={block.content || ""} placeholder={placeholder} onChange={(event) => update({ content: event.target.value })} />;
}
