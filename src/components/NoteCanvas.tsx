import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
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
  const dragged = useRef("");
  const update = (id: string, patch: Partial<NoteBlock>) => onChange(blocks.map((block) => (block.id === id ? { ...block, ...patch } : block)));
  const insert = (block: NoteBlock) => onChange([...blocks, block]);
  const chooseImage = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { alert("圖片請小於 12 MB"); return; }
    const reader = new FileReader();
    reader.onload = () => insert({ id: makeId("block"), type: "image", dataUrl: String(reader.result), width: 70 });
    reader.readAsDataURL(file);
    event.target.value = "";
  };
  const drop = (targetId: string, event: DragEvent) => {
    event.preventDefault();
    const fromId = dragged.current;
    dragged.current = "";
    if (!fromId || fromId === targetId) return;
    const next = [...blocks];
    const from = next.findIndex((item) => item.id === fromId), to = next.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    onChange(next);
  };
  return (
    <section className="block-editor">
      <div className="block-toolbar">
        {labels.map(([type, label]) => <button key={type} type="button" onClick={() => insert(createBlock(type))}>＋ {label}</button>)}
        <label>▧ 加入圖片<input hidden type="file" accept="image/*" onChange={chooseImage} /></label>
        <button type="button" onClick={() => setDrawing(true)}>✎ 簡易畫筆</button>
      </div>
      <p className="block-help">區塊可以拖曳排序；圖片、表格與列表都能放在文字中間。</p>
      <div className="note-blocks">
        {blocks.length === 0 && <button className="empty-block" onClick={() => insert(createBlock("paragraph"))}>＋ 從第一段文字開始</button>}
        {blocks.map((block) => (
          <article key={block.id} className={`note-block block-${block.type}`} draggable onDragStart={() => (dragged.current = block.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => drop(block.id, event)}>
            <div className="block-side"><span title="拖曳排序">⋮⋮</span><button aria-label="刪除區塊" onClick={() => onChange(blocks.filter((item) => item.id !== block.id))}>×</button></div>
            <BlockContent block={block} update={(patch) => update(block.id, patch)} />
          </article>
        ))}
      </div>
      {drawing && <DrawingPad onClose={() => setDrawing(false)} onSave={(dataUrl) => { insert({ id: makeId("block"), type: "drawing", dataUrl, width: 70 }); setDrawing(false); }} />}
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
    return <div className="check-block">{lines.map((line, index) => <label key={index}><input type="checkbox" checked={Boolean(checked[index])} onChange={(event) => { const next = [...checked]; next[index] = event.target.checked; update({ checked: next }); }} /><input value={line} placeholder="待辦項目" onChange={(event) => { const next = [...lines]; next[index] = event.target.value; update({ content: next.join("\n") }); }} /></label>)}<button onClick={() => update({ content: [...lines, ""].join("\n") })}>＋ 新增項目</button></div>;
  }
  if (block.type === "bulletList" || block.type === "numberList") {
    const lines = (block.content || "").split("\n");
    return <div className="structured-list">{lines.map((line, index) => <label key={index}><b>{block.type === "bulletList" ? "•" : `${index + 1}.`}</b><input value={line} placeholder="列表項目" onChange={(event) => { const next = [...lines]; next[index] = event.target.value; update({ content: next.join("\n") }); }} /></label>)}<button onClick={() => update({ content: [...lines, ""].join("\n") })}>＋ 新增項目</button></div>;
  }
  const placeholder = block.type === "heading" ? "輸入標題" : block.type === "quote" ? "輸入引言" : "輸入文字……";
  return <textarea className="block-text" rows={block.type === "heading" ? 1 : 3} value={block.content || ""} placeholder={placeholder} onChange={(event) => update({ content: event.target.value })} />;
}
