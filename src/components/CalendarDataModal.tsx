import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import {
  makeId,
  type AppState,
  type Birthday,
  type Holiday,
} from "../data/types";

type Setter = Dispatch<SetStateAction<AppState>>;

const parseCsvRow = (line: string) => {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"' && line[index + 1] === '"' && quoted) {
      current += '"';
      index++;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
};

/** Parse the government open-data calendar CSV, including its YYYYMMDD dates. */
export const parseGovernmentCalendarCsv = (text: string): Holiday[] => {
  const rows = text
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (rows.length < 2) throw new Error("invalid");
  const headers = parseCsvRow(rows[0]).map((header) =>
    header.replace(/^\uFEFF/, "").trim().toLowerCase(),
  );
  const find = (names: string[]) =>
    headers.findIndex((header) => names.some((name) => header.includes(name)));
  const dateIndex = find(["西元日期", "日期", "date"]);
  const nameIndex = find(["備註", "節日", "名稱", "name", "description"]);
  const workIndex = find(["是否放假", "放假", "work", "holiday"]);
  if (dateIndex < 0) throw new Error("invalid");
  const values: Holiday[] = [];
  for (const row of rows.slice(1)) {
    const cells = parseCsvRow(row);
    const rawDate = (cells[dateIndex] || "").trim();
    const separated = rawDate.match(
      /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/,
    );
    const compact = rawDate.match(/^(\d{4})(\d{2})(\d{2})$/);
    const match = separated || compact;
    if (!match) continue;
    const date = `${match[1]}-${String(Number(match[2])).padStart(2, "0")}-${String(Number(match[3])).padStart(2, "0")}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const note = nameIndex >= 0 ? (cells[nameIndex] || "").trim() : "";
    const work = workIndex >= 0 ? (cells[workIndex] || "").trim() : "";
    const makeup =
      /補班|補行|調整上班|上班日|工作日|補課/.test(note) ||
      /補班|補行|調整上班|上班/.test(work);
    const dayOff = /^(2|1|是|放假|休假|yes|y)$/i.test(work);
    // The government CSV includes every weekend as 是否放假=2. Weekends
    // are already rendered by the calendar, so only named holidays and
    // explicit makeup/workday rows should become imported records.
    if (!note && !makeup && !dayOff) continue;
    if (!note && dayOff) continue;
    values.push({
      id: makeId("holiday"),
      date,
      name: note || "調整上班日",
      type: makeup ? "makeup" : "national",
    });
  }
  if (!values.length) throw new Error("invalid");
  return values;
};

export default function CalendarDataModal({
  state,
  setState,
  onClose,
}: {
  state: AppState;
  setState: Setter;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"birthday" | "holiday">("birthday");
  const [birthday, setBirthday] = useState<Birthday>({
    id: makeId("birthday"),
    name: "",
    calendar: "solar",
    month: 1,
    day: 1,
  });
  const [holiday, setHoliday] = useState<Holiday>({
    id: makeId("holiday"),
    date: `${new Date().getFullYear()}-01-01`,
    name: "",
    type: "national",
  });
  const holidays = useMemo(
    () =>
      [...state.holidays]
        .filter((item) => !item.deletedAt)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [state.holidays],
  );
  const maxBirthdayDay =
    birthday.calendar === "lunar"
      ? 30
      : [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][birthday.month - 1] ||
        31;

  const importHolidays = async (file?: File) => {
    if (!file) return;
    try {
      const text = await file.text();
      const values: Holiday[] = file.name.toLowerCase().endsWith(".csv")
        ? parseGovernmentCalendarCsv(text)
        : (() => {
            const parsed = JSON.parse(text) as Array<Partial<Holiday>>;
            if (!Array.isArray(parsed)) throw new Error("invalid");
            return parsed.map((item) => {
              if (!/^\d{4}-\d{2}-\d{2}$/.test(item.date || "") || !item.name?.trim())
                throw new Error("invalid");
              return {
                id: item.id || makeId("holiday"),
                date: item.date!,
                name: item.name.trim(),
                type:
                  item.type === "makeup" || item.type === "custom"
                    ? item.type
                    : "national",
              };
            });
          })();
      setState((current) => ({
        ...current,
        holidays: [
          ...current.holidays.filter(
            (old) =>
              !values.some(
                (item) => item.date === old.date && item.name === old.name,
              ),
          ),
          ...values,
        ],
      }));
    } catch {
      alert("行事曆檔案格式不正確。請使用政府資料開放平台 CSV（西元日期、是否放假、備註欄），或既有 JSON 格式。");
    }
  };

  return (
    <div
      className="modal-layer"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <section
        className="modal calendar-data-modal"
        role="dialog"
        aria-modal="true"
        aria-label="生日與假日管理"
      >
        <header>
          <div>
            <small>CALENDAR DATA</small>
            <h2>生日與假日管理</h2>
          </div>
          <button className="close" aria-label="關閉" onClick={onClose}>
            ×
          </button>
        </header>
        <div className="type-tabs calendar-data-tabs">
          <button
            className={tab === "birthday" ? "active" : ""}
            onClick={() => setTab("birthday")}
          >
            🎂 生日
          </button>
          <button
            className={tab === "holiday" ? "active" : ""}
            onClick={() => setTab("holiday")}
          >
            ◎ 年度假日
          </button>
        </div>
        <div className="modal-body calendar-data-body">
          {tab === "birthday" ? (
            <>
              <div className="calendar-data-form">
                <label>
                  <span>姓名</span>
                  <input
                    aria-label="生日姓名"
                    value={birthday.name}
                    onChange={(e) =>
                      setBirthday({ ...birthday, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>曆法</span>
                  <select
                    aria-label="生日曆法"
                    value={birthday.calendar}
                    onChange={(e) =>
                      setBirthday({
                        ...birthday,
                        calendar: e.target.value as Birthday["calendar"],
                        leapMonth: false,
                      })
                    }
                  >
                    <option value="solar">陽曆</option>
                    <option value="lunar">農曆</option>
                  </select>
                </label>
                <label>
                  <span>月</span>
                  <input
                    aria-label="生日月"
                    type="number"
                    min="1"
                    max="12"
                    value={birthday.month}
                    onChange={(e) =>
                      setBirthday({
                        ...birthday,
                        month: Number(e.target.value),
                      })
                    }
                  />
                </label>
                <label>
                  <span>日</span>
                  <input
                    aria-label="生日日"
                    type="number"
                    min="1"
                    max={maxBirthdayDay}
                    value={birthday.day}
                    onChange={(e) =>
                      setBirthday({ ...birthday, day: Number(e.target.value) })
                    }
                  />
                </label>
                <label>
                  <span>出生年（選填）</span>
                  <input
                    aria-label="出生年"
                    type="number"
                    min="1900"
                    max="2200"
                    value={birthday.birthYear || ""}
                    onChange={(e) =>
                      setBirthday({
                        ...birthday,
                        birthYear: e.target.value
                          ? Number(e.target.value)
                          : undefined,
                      })
                    }
                  />
                </label>
                {birthday.calendar === "lunar" && (
                  <>
                    <label className="check-line">
                      <input
                        type="checkbox"
                        checked={Boolean(birthday.leapMonth)}
                        onChange={(e) =>
                          setBirthday({
                            ...birthday,
                            leapMonth: e.target.checked,
                            leapFallback: e.target.checked
                              ? "regular"
                              : undefined,
                          })
                        }
                      />
                      <span>這是閏月生日</span>
                    </label>
                    {birthday.leapMonth && (
                      <label>
                        <span>當年沒有這個閏月</span>
                        <select
                          aria-label="閏月生日規則"
                          value={birthday.leapFallback || "regular"}
                          onChange={(e) =>
                            setBirthday({
                              ...birthday,
                              leapFallback: e.target.value as
                                "regular" | "skip",
                            })
                          }
                        >
                          <option value="regular">改在同月同日祝壽</option>
                          <option value="skip">當年不顯示</option>
                        </select>
                      </label>
                    )}
                  </>
                )}
                <button
                  className="primary"
                  disabled={
                    !birthday.name.trim() ||
                    birthday.month < 1 ||
                    birthday.month > 12 ||
                    birthday.day < 1 ||
                    birthday.day > maxBirthdayDay
                  }
                  onClick={() => {
                    setState((current) => ({
                      ...current,
                      birthdays: [
                        ...current.birthdays,
                        { ...birthday, name: birthday.name.trim() },
                      ],
                    }));
                    setBirthday({
                      id: makeId("birthday"),
                      name: "",
                      calendar: "solar",
                      month: 1,
                      day: 1,
                    });
                  }}
                >
                  ＋ 加入生日
                </button>
              </div>
              <div className="calendar-data-list">
                {state.birthdays
                  .filter((item) => !item.deletedAt)
                  .map((item) => (
                    <article key={item.id}>
                      <div>
                        <strong>{item.name}</strong>
                        <small>
                          {item.calendar === "lunar"
                            ? `農曆${item.leapMonth ? "閏" : ""} ${item.month}/${item.day}`
                            : `陽曆 ${item.month}/${item.day}`}
                          {item.birthYear ? ` · ${item.birthYear} 年生` : ""}
                        </small>
                      </div>
                      <button
                        aria-label={`刪除生日 ${item.name}`}
                        onClick={() =>
                          setState((current) => ({
                            ...current,
                            birthdays: current.birthdays.filter(
                              (value) => value.id !== item.id,
                            ),
                          }))
                        }
                      >
                        ×
                      </button>
                    </article>
                  ))}
              </div>
            </>
          ) : tab === "holiday" ? (
            <>
              <div className="calendar-data-form holiday-form">
                <label>
                  <span>日期</span>
                  <input
                    aria-label="假日日期"
                    type="date"
                    value={holiday.date}
                    onChange={(e) =>
                      setHoliday({ ...holiday, date: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>名稱</span>
                  <input
                    aria-label="假日名稱"
                    value={holiday.name}
                    onChange={(e) =>
                      setHoliday({ ...holiday, name: e.target.value })
                    }
                  />
                </label>
                <label>
                  <span>類型</span>
                  <select
                    aria-label="假日類型"
                    value={holiday.type}
                    onChange={(e) =>
                      setHoliday({
                        ...holiday,
                        type: e.target.value as Holiday["type"],
                      })
                    }
                  >
                    <option value="national">國定假日／放假</option>
                    <option value="makeup">補班日</option>
                    <option value="custom">自訂特別日</option>
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={!holiday.date || !holiday.name.trim()}
                  onClick={() => {
                    setState((current) => ({
                      ...current,
                      holidays: [
                        ...current.holidays,
                        { ...holiday, name: holiday.name.trim() },
                      ],
                    }));
                    setHoliday({
                      id: makeId("holiday"),
                      date: holiday.date,
                      name: "",
                      type: "national",
                    });
                  }}
                >
                  ＋ 加入日期
                </button>
                <label className="secondary import-calendar">
                  匯入政府 CSV／JSON
                  <input
                    hidden
                    type="file"
                    accept="text/csv,.csv,application/json,.json"
                    onChange={(e) => {
                      void importHolidays(e.target.files?.[0]);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>
              <div className="calendar-data-list holiday-list">
                {holidays.map((item) => (
                  <article key={item.id}>
                    <div>
                      <strong>{item.name}</strong>
                      <small>
                        {item.date} ·{" "}
                        {item.type === "makeup"
                          ? "補班"
                          : item.type === "custom"
                            ? "自訂"
                            : "放假"}
                      </small>
                    </div>
                    <button
                      aria-label={`刪除假日 ${item.name}`}
                      onClick={() =>
                        setState((current) => ({
                          ...current,
                          holidays: current.holidays.filter(
                            (value) => value.id !== item.id,
                          ),
                        }))
                      }
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
