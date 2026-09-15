import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { makeId, type NoteAsset } from "../data/types";

type Props = { assets: NoteAsset[]; onChange: (assets: NoteAsset[]) => void };

function DrawingPad({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [color, setColor] = useState("#5d4b86");
  const [width, setWidth] = useState(4);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#fffdf8";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
  }, []);
  const point = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const r = canvas.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) * canvas.width) / r.width,
      y: ((e.clientY - r.top) * canvas.height) / r.height,
    };
  };
  const start = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = point(e),
      ctx = e.currentTarget.getContext("2d")!;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
  };
  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const p = point(e),
      ctx = e.currentTarget.getContext("2d")!;
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  };
  return (
    <div
      className="modal-layer"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal drawing-modal"
        role="dialog"
        aria-label="簡易畫筆"
      >
        <header>
          <div>
            <small>SKETCH</small>
            <h2>簡易畫筆</h2>
          </div>
          <button aria-label="關閉" className="close" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="drawing-tools">
          <label>
            顏色{" "}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
            />
          </label>
          <label>
            粗細{" "}
            <input
              type="range"
              min="1"
              max="18"
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
            />
          </label>
          <button
            onClick={() => {
              const c = canvasRef.current!,
                ctx = c.getContext("2d")!;
              ctx.fillStyle = "#fffdf8";
              ctx.fillRect(0, 0, c.width, c.height);
            }}
          >
            清除
          </button>
        </div>
        <canvas
          ref={canvasRef}
          width="900"
          height="520"
          onPointerDown={start}
          onPointerMove={move}
          onPointerUp={() => (drawing.current = false)}
          onPointerCancel={() => (drawing.current = false)}
        />
        <footer>
          <span>畫完會以圖片放進本章</span>
          <button
            onClick={() => onSave(canvasRef.current!.toDataURL("image/png"))}
          >
            放進筆記
          </button>
        </footer>
      </section>
    </div>
  );
}

export default function NoteCanvas({ assets, onChange }: Props) {
  const [drawing, setDrawing] = useState(false);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const add = (dataUrl: string, type: NoteAsset["type"]) =>
    onChange([
      ...assets,
      {
        id: makeId("asset"),
        type,
        dataUrl,
        x: 24 + assets.length * 18,
        y: 28 + assets.length * 18,
        width: 260,
      },
    ]);
  const choose = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      alert("圖片請小於 8 MB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => add(String(reader.result), "image");
    reader.readAsDataURL(file);
    e.target.value = "";
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    const board = e.currentTarget.getBoundingClientRect(),
      asset = assets.find((x) => x.id === drag.current!.id)!;
    const maxX = Math.max(0, board.width - asset.width);
    onChange(
      assets.map((x) =>
        x.id === asset.id
          ? {
              ...x,
              x: Math.max(
                0,
                Math.min(maxX, e.clientX - board.left - drag.current!.dx),
              ),
              y: Math.max(0, e.clientY - board.top - drag.current!.dy),
            }
          : x,
      ),
    );
  };
  return (
    <section className="asset-editor">
      <div className="asset-toolbar">
        <label className="secondary">
          ▧ 加入圖片
          <input hidden type="file" accept="image/*" onChange={choose} />
        </label>
        <button className="secondary" onClick={() => setDrawing(true)}>
          ✎ 簡易畫筆
        </button>
        <small>圖片與塗鴉都能拖到想放的位置</small>
      </div>
      <div
        className="asset-board"
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        {assets.length === 0 && <p>圖片與塗鴉會放在這裡，可以自由排版。</p>}
        {assets.map((asset) => (
          <div
            className="note-asset"
            key={asset.id}
            style={{ left: asset.x, top: asset.y, width: asset.width }}
            onPointerDown={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              drag.current = {
                id: asset.id,
                dx: e.clientX - r.left,
                dy: e.clientY - r.top,
              };
              e.currentTarget.setPointerCapture(e.pointerId);
            }}
          >
            <img
              draggable={false}
              src={asset.dataUrl}
              alt={asset.type === "drawing" ? "手繪內容" : "筆記圖片"}
            />
            <div>
              <input
                aria-label="圖片尺寸"
                type="range"
                min="120"
                max="640"
                value={asset.width}
                onPointerDown={(e) => e.stopPropagation()}
                onChange={(e) =>
                  onChange(
                    assets.map((x) =>
                      x.id === asset.id
                        ? { ...x, width: Number(e.target.value) }
                        : x,
                    ),
                  )
                }
              />
              <button
                aria-label="刪除圖片"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() =>
                  onChange(assets.filter((x) => x.id !== asset.id))
                }
              >
                ×
              </button>
            </div>
          </div>
        ))}
      </div>
      {drawing && (
        <DrawingPad
          onClose={() => setDrawing(false)}
          onSave={(data) => {
            add(data, "drawing");
            setDrawing(false);
          }}
        />
      )}
    </section>
  );
}
