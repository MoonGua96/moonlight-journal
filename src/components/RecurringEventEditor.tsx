import { useState, type ReactNode } from "react";
import { makeId, type RecurringEvent } from "../data/types";

const colors: RecurringEvent["color"][] = ["purple", "gold", "sage", "blue"];

export default function RecurringEventEditor({
  value,
  occurrenceDate,
  onClose,
  onSave,
  onDeleteOccurrence,
  onDeleteSeries,
  embedded = false,
}: {
  value?: RecurringEvent;
  occurrenceDate: string;
  onClose: () => void;
  onSave: (event: RecurringEvent) => void;
  onDeleteOccurrence: (event: RecurringEvent, date: string) => void;
  onDeleteSeries: (event: RecurringEvent) => void;
  embedded?: boolean;
}) {
  const date = new Date(`${occurrenceDate}T12:00:00`);
  const [scope, setScope] = useState<"series" | "occurrence">("series");
  const [form, setForm] = useState<RecurringEvent>(
    value || {
      id: makeId("recurring"),
      title: "",
      weekday: date.getDay(),
      startTime: "18:00",
      endTime: "19:00",
      startDate: occurrenceDate,
      endDate: occurrenceDate,
      color: "purple",
      exceptions: [],
      overrides: {},
    },
  );
  const valid = Boolean(
    form.title.trim() &&
    form.startDate &&
    form.endDate &&
    form.startDate <= form.endDate,
  );
  const submit = () => {
    if (!valid) return;
    if (value && scope === "occurrence")
      onSave({
        ...value,
        overrides: {
          ...value.overrides,
          [occurrenceDate]: {
            title: form.title.trim(),
            startTime: form.startTime,
            endTime: form.endTime,
            color: form.color,
          },
        },
      });
    else onSave({ ...form, title: form.title.trim() });
  };
  const editor = (
      <section className={embedded ? "recurring-editor-embedded" : "modal recurring-event-modal"}>
        <header>
          <div>
            <small>WEEKLY</small>
            <h2>{value ? "編輯固定行程" : "新增每週固定行程"}</h2>
          </div>
          <button aria-label="關閉" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="modal-body">
          {value && (
            <Field label="修改範圍">
              <select
                value={scope}
                onChange={(event) =>
                  setScope(event.target.value as "series" | "occurrence")
                }
              >
                <option value="series">整組固定行程</option>
                <option value="occurrence">
                  只修改 {occurrenceDate} 這一次
                </option>
              </select>
            </Field>
          )}
          <Field label="內容">
            <input
              autoFocus
              value={form.title}
              onChange={(event) =>
                setForm({ ...form, title: event.target.value })
              }
            />
          </Field>
          {scope === "series" && (
            <>
              <Field label="星期">
                <select
                  value={form.weekday}
                  onChange={(event) =>
                    setForm({ ...form, weekday: Number(event.target.value) })
                  }
                >
                  {["日", "一", "二", "三", "四", "五", "六"].map(
                    (label, index) => (
                      <option key={label} value={index}>
                        星期{label}
                      </option>
                    ),
                  )}
                </select>
              </Field>
              <div className="field-row">
                <Field label="起始日">
                  <input
                    type="date"
                    value={form.startDate}
                    onChange={(event) =>
                      setForm({ ...form, startDate: event.target.value })
                    }
                  />
                </Field>
                <Field label="結束日">
                  <input
                    type="date"
                    min={form.startDate}
                    value={form.endDate}
                    onChange={(event) =>
                      setForm({ ...form, endDate: event.target.value })
                    }
                  />
                </Field>
              </div>
            </>
          )}
          <div className="field-row">
            <Field label="開始時間">
              <input
                type="time"
                value={form.startTime}
                onChange={(event) =>
                  setForm({ ...form, startTime: event.target.value })
                }
              />
            </Field>
            <Field label="結束時間">
              <input
                type="time"
                value={form.endTime}
                onChange={(event) =>
                  setForm({ ...form, endTime: event.target.value })
                }
              />
            </Field>
          </div>
          <Field label="顏色">
            <div className="color-picks">
              {colors.map((color) => (
                <button
                  key={color}
                  aria-label={color}
                  className={`${color} ${form.color === color ? "selected" : ""}`}
                  onClick={() => setForm({ ...form, color })}
                />
              ))}
            </div>
          </Field>
        </div>
        <footer>
          {value ? (
            <span className="modal-danger-actions">
              <button
                className="secondary"
                onClick={() => onDeleteOccurrence(value, occurrenceDate)}
              >
                刪除這次
              </button>
              <button className="delete" onClick={() => onDeleteSeries(value)}>
                刪除整組
              </button>
            </span>
          ) : (
            <span>只會出現在設定的起迄日內</span>
          )}
          <button disabled={!valid} onClick={submit}>
            儲存
          </button>
        </footer>
      </section>
  );
  if (embedded) return editor;
  return (
    <div
      className="modal-layer"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      {editor}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
