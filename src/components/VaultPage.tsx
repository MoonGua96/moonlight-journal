import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type DragEvent,
  type SetStateAction,
} from "react";
import {
  changeVaultPassword,
  emptyVault,
  sealVault,
  unlockVault,
  type VaultContents,
  type VaultEntry,
} from "../data/vault";
import { makeId, type AppState } from "../data/types";

type Setter = Dispatch<SetStateAction<AppState>>;

const blankEntry = (categoryId = ""): VaultEntry => ({
  id: makeId("secret"),
  service: "",
  url: "",
  account: "",
  password: "",
  note: "",
  tags: [],
  categoryId,
  position: 999,
  updatedAt: new Date().toISOString(),
});

const makePassword = () => {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*()-_=+";
  const values = crypto.getRandomValues(new Uint32Array(20));
  return Array.from(values, (value) => chars[value % chars.length]).join("");
};

export default function VaultPage({
  state,
  setState,
}: {
  state: AppState;
  setState: Setter;
}) {
  const [username, setUsername] = useState(state.vault?.username || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [contents, setContents] = useState<VaultContents | null>(null);
  const [sessionPassword, setSessionPassword] = useState("");
  const [editing, setEditing] = useState<VaultEntry | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState("");
  const [changingPassword, setChangingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordAgain, setNewPasswordAgain] = useState("");
  const [passwordChangeError, setPasswordChangeError] = useState("");
  const [categoryId, setCategoryId] = useState("all");
  const idle = useRef<number | undefined>(undefined);
  const vaultDrag = useRef<{ kind: "category" | "entry"; id: string } | null>(
    null,
  );

  const lock = () => {
    setContents(null);
    setSessionPassword("");
    setPassword("");
    setEditing(null);
    setChangingPassword(false);
    setCurrentPassword("");
    setNewPassword("");
    setNewPasswordAgain("");
  };
  const closePasswordChange = () => {
    setChangingPassword(false);
    setCurrentPassword("");
    setNewPassword("");
    setNewPasswordAgain("");
    setPasswordChangeError("");
  };

  useEffect(() => {
    if (!contents) return;
    const reset = () => {
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(lock, 5 * 60 * 1000);
    };
    const hidden = () => document.hidden && lock();
    for (const name of ["pointerdown", "keydown"] as const)
      window.addEventListener(name, reset);
    document.addEventListener("visibilitychange", hidden);
    reset();
    return () => {
      window.clearTimeout(idle.current);
      for (const name of ["pointerdown", "keydown"] as const)
        window.removeEventListener(name, reset);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [contents]);

  const create = async () => {
    if (
      !username.trim() ||
      password.length < 10 ||
      password !== confirmPassword
    )
      return;
    setBusy(true);
    setError("");
    try {
      const value = emptyVault();
      const envelope = await sealVault(username.trim(), password, value);
      setState((current) => ({ ...current, vault: envelope }));
      setContents(value);
      setSessionPassword(password);
      setPassword("");
      setConfirmPassword("");
    } catch {
      setError("無法建立保管庫，請稍後再試。");
    } finally {
      setBusy(false);
    }
  };

  const unlock = async () => {
    if (!state.vault || !username.trim() || !password) return;
    setBusy(true);
    setError("");
    try {
      const value = await unlockVault(state.vault, username, password);
      setContents(value);
      setSessionPassword(password);
      setPassword("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "帳號或主密碼錯誤");
    } finally {
      setBusy(false);
    }
  };

  const persist = async (next: VaultContents) => {
    if (!state.vault || !sessionPassword) return;
    const envelope = await sealVault(
      state.vault.username,
      sessionPassword,
      next,
      state.vault.salt,
    );
    setContents(next);
    setState((current) => ({ ...current, vault: envelope }));
  };
  const dropReorder = (
    kind: "category" | "entry",
    targetId: string,
    event: DragEvent,
  ) => {
    event.preventDefault();
    const drag = vaultDrag.current;
    const currentContents = contents;
    vaultDrag.current = null;
    if (!currentContents || !drag || drag.kind !== kind || drag.id === targetId) return;
    if (kind === "category") {
      const ordered = [...currentContents.categories].sort(
        (a, b) => a.position - b.position,
      );
      const from = ordered.findIndex((item) => item.id === drag.id),
        to = ordered.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return;
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      void persist({
        ...currentContents,
        categories: ordered.map((item, position) => ({ ...item, position })),
      });
    } else {
      const ordered = [...currentContents.entries].sort(
        (a, b) => (a.position ?? 0) - (b.position ?? 0),
      );
      const from = ordered.findIndex((item) => item.id === drag.id),
        to = ordered.findIndex((item) => item.id === targetId);
      if (from < 0 || to < 0) return;
      const [moved] = ordered.splice(from, 1);
      ordered.splice(to, 0, moved);
      void persist({
        ...currentContents,
        entries: ordered.map((item, position) => ({ ...item, position })),
      });
    }
  };

  const copy = async (value: string, id: string) => {
    await navigator.clipboard.writeText(value);
    setCopied(id);
    window.setTimeout(async () => {
      try {
        if ((await navigator.clipboard.readText()) === value)
          await navigator.clipboard.writeText("");
      } catch {
        // Clipboard read permission is optional; never interrupt the vault UI.
      }
      setCopied((current) => (current === id ? "" : current));
    }, 30_000);
  };

  const updateMasterPassword = async () => {
    if (
      !state.vault ||
      !currentPassword ||
      newPassword.length < 10 ||
      newPassword !== newPasswordAgain
    )
      return;
    setBusy(true);
    setPasswordChangeError("");
    try {
      const envelope = await changeVaultPassword(
        state.vault,
        currentPassword,
        newPassword,
      );
      setState((current) => ({ ...current, vault: envelope }));
      setSessionPassword(newPassword);
      closePasswordChange();
    } catch (reason) {
      setPasswordChangeError(
        reason instanceof Error ? reason.message : "目前的主密碼不正確",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!contents) {
    const creating = !state.vault;
    return (
      <div className="page vault-lock">
        <section className="panel vault-gate">
          <div className="vault-mark">🔐</div>
          <small>ENCRYPTED VAULT</small>
          <h2>{creating ? "建立密碼保管庫" : "解鎖密碼保管庫"}</h2>
          <p>
            {creating
              ? "這組帳號與主密碼只用於保護你的本地密碼庫。"
              : "輸入正確資料後才會在記憶體中解密。"}
          </p>
          <label>
            <span>保管庫帳號</span>
            <input
              value={username}
              autoComplete="username"
              onChange={(e) => setUsername(e.target.value)}
            />
          </label>
          <label>
            <span>主密碼</span>
            <input
              type="password"
              value={password}
              autoComplete={creating ? "new-password" : "current-password"}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {creating && (
            <label>
              <span>再輸入一次</span>
              <input
                type="password"
                value={confirmPassword}
                autoComplete="new-password"
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
            </label>
          )}
          {creating && password && password.length < 10 && (
            <p className="vault-error">主密碼至少需要 10 個字元。</p>
          )}
          {creating && confirmPassword && password !== confirmPassword && (
            <p className="vault-error">兩次主密碼不一致。</p>
          )}
          {error && (
            <p className="vault-error">
              {error}；資料沒有被刪除，可以繼續嘗試。
            </p>
          )}
          <button
            className="primary"
            disabled={
              busy ||
              !username.trim() ||
              !password ||
              (creating &&
                (password.length < 10 || password !== confirmPassword))
            }
            onClick={() => void (creating ? create() : unlock())}
          >
            {busy ? "正在安全處理……" : creating ? "建立並解鎖" : "解鎖"}
          </button>
          <small className="vault-warning">
            忘記主密碼後無法強制復原；輸錯不會刪除或鎖死資料。
          </small>
        </section>
      </div>
    );
  }

  return (
    <div className="page vault-page">
      <div className="page-tools">
        <p>
          {contents.entries.length} 筆已加密的帳密，離開這頁即釋放解密內容。
        </p>
        <div className="vault-actions">
          <button
            className="secondary"
            onClick={() => {
              setPasswordChangeError("");
              setChangingPassword(true);
            }}
          >
            變更主密碼
          </button>
          <button className="secondary" onClick={lock}>
            立即上鎖
          </button>
          <button
            className="primary"
            onClick={() =>
              setEditing(
                blankEntry(
                  categoryId === "all"
                    ? contents.categories[0]?.id
                    : categoryId,
                ),
              )
            }
          >
            ＋ 新增帳密
          </button>
        </div>
      </div>
      <div className="vault-categories">
        <button
          className={categoryId === "all" ? "active" : ""}
          onClick={() => setCategoryId("all")}
        >
          全部
        </button>
        {[...contents.categories]
          .sort((a, b) => a.position - b.position)
          .map((category) => (
            <span
              key={category.id}
              draggable
              onDragStart={() => {
                vaultDrag.current = { kind: "category", id: category.id };
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropReorder("category", category.id, event)}
            >
              <button
                className={categoryId === category.id ? "active" : ""}
                onClick={() => setCategoryId(category.id)}
              >
                {category.name}
              </button>
              <button
                aria-label={`重新命名 ${category.name}`}
                onClick={() => {
                  const name = prompt("分類名稱", category.name)?.trim();
                  if (name)
                    void persist({
                      ...contents,
                      categories: contents.categories.map((item) =>
                        item.id === category.id ? { ...item, name } : item,
                      ),
                    });
                }}
              >
                ✎
              </button>
              <button
                aria-label={`刪除 ${category.name}`}
                disabled={contents.categories.length === 1}
                onClick={() => {
                  const fallback = contents.categories.find(
                    (item) => item.id !== category.id,
                  );
                  if (
                    !fallback ||
                    !confirm(
                      `刪除分類「${category.name}」？裡面的帳密會移到「${fallback.name}」。`,
                    )
                  )
                    return;
                  void persist({
                    categories: contents.categories
                      .filter((item) => item.id !== category.id)
                      .map((item, position) => ({ ...item, position })),
                    entries: contents.entries.map((entry) =>
                      entry.categoryId === category.id
                        ? { ...entry, categoryId: fallback.id }
                        : entry,
                    ),
                  });
                  setCategoryId("all");
                }}
              >
                ×
              </button>
            </span>
          ))}
        <button
          onClick={() => {
            const name = prompt("新增分類名稱")?.trim();
            if (name)
              void persist({
                ...contents,
                categories: [
                  ...contents.categories,
                  {
                    id: makeId("vault-category"),
                    name,
                    position: contents.categories.length,
                  },
                ],
              });
          }}
        >
          ＋ 分類
        </button>
      </div>
      <div className="vault-list">
        {!contents.entries.length && (
          <p className="empty">保管庫還是空的，先放進第一組帳密吧。</p>
        )}
        {[...contents.entries]
          .filter(
            (entry) => categoryId === "all" || entry.categoryId === categoryId,
          )
          .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
          .map((entry) => (
            <article
              className="panel vault-card"
              key={entry.id}
              draggable
              onDragStart={() => {
                vaultDrag.current = { kind: "entry", id: entry.id };
              }}
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => dropReorder("entry", entry.id, event)}
            >
              <div>
                <small>{entry.url || "LOCAL / APP"}</small>
                <h3>{entry.service}</h3>
                <span>{entry.account}</span>
              </div>
              <div className="vault-card-actions">
                <button
                  onClick={() =>
                    void copy(entry.account, `${entry.id}-account`)
                  }
                >
                  {copied === `${entry.id}-account` ? "已複製" : "複製帳號"}
                </button>
                <button
                  onClick={() =>
                    void copy(entry.password, `${entry.id}-password`)
                  }
                >
                  {copied === `${entry.id}-password` ? "已複製" : "複製密碼"}
                </button>
                <button onClick={() => setEditing(entry)}>編輯</button>
              </div>
            </article>
          ))}
      </div>
      {editing && (
        <div
          className="modal-layer"
          onMouseDown={(e) => e.target === e.currentTarget && setEditing(null)}
        >
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="帳密內容"
          >
            <header>
              <h2>
                {contents.entries.some((item) => item.id === editing.id)
                  ? "編輯帳密"
                  : "新增帳密"}
              </h2>
              <button
                className="close"
                aria-label="關閉"
                onClick={() => setEditing(null)}
              >
                ×
              </button>
            </header>
            <div className="modal-body vault-form">
              <label>
                <span>分類</span>
                <select
                  value={editing.categoryId}
                  onChange={(e) =>
                    setEditing({ ...editing, categoryId: e.target.value })
                  }
                >
                  {[...contents.categories]
                    .sort((a, b) => a.position - b.position)
                    .map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                <span>軟體或網站</span>
                <input
                  aria-label="軟體或網站"
                  value={editing.service}
                  onChange={(e) =>
                    setEditing({ ...editing, service: e.target.value })
                  }
                />
              </label>
              <label>
                <span>網址</span>
                <input
                  aria-label="網址"
                  value={editing.url}
                  onChange={(e) =>
                    setEditing({ ...editing, url: e.target.value })
                  }
                />
              </label>
              <label>
                <span>登入帳號</span>
                <input
                  aria-label="登入帳號"
                  value={editing.account}
                  onChange={(e) =>
                    setEditing({ ...editing, account: e.target.value })
                  }
                />
              </label>
              <label>
                <span>密碼</span>
                <div className="password-row">
                  <input
                    aria-label="密碼"
                    value={editing.password}
                    onChange={(e) =>
                      setEditing({ ...editing, password: e.target.value })
                    }
                  />
                  <button
                    className="secondary"
                    onClick={() =>
                      setEditing({ ...editing, password: makePassword() })
                    }
                  >
                    產生
                  </button>
                </div>
              </label>
              <label>
                <span>備註</span>
                <textarea
                  aria-label="備註"
                  value={editing.note}
                  onChange={(e) =>
                    setEditing({ ...editing, note: e.target.value })
                  }
                />
              </label>
            </div>
            <footer className="modal-actions">
              {contents.entries.some((item) => item.id === editing.id) && (
                <button
                  className="danger"
                  onClick={() => {
                    void persist({
                      ...contents,
                      entries: contents.entries.filter(
                        (item) => item.id !== editing.id,
                      ),
                    });
                    setEditing(null);
                  }}
                >
                  刪除
                </button>
              )}
              <button className="secondary" onClick={() => setEditing(null)}>
                取消
              </button>
              <button
                className="primary"
                disabled={!editing.service.trim() || !editing.password}
                onClick={() => {
                  const value = {
                    ...editing,
                    service: editing.service.trim(),
                    updatedAt: new Date().toISOString(),
                  };
                  void persist({
                    ...contents,
                    entries: contents.entries.some(
                      (item) => item.id === value.id,
                    )
                      ? contents.entries.map((item) =>
                          item.id === value.id ? value : item,
                        )
                      : [
                          ...contents.entries,
                          { ...value, position: contents.entries.length },
                        ],
                  });
                  setEditing(null);
                }}
              >
                加密儲存
              </button>
            </footer>
          </section>
        </div>
      )}
      {changingPassword && (
        <div
          className="modal-layer"
          onMouseDown={(e) =>
            e.target === e.currentTarget && closePasswordChange()
          }
        >
          <section
            className="modal vault-password-modal"
            role="dialog"
            aria-modal="true"
            aria-label="變更主密碼"
          >
            <header>
              <div>
                <small>RE-ENCRYPT VAULT</small>
                <h2>變更主密碼</h2>
              </div>
              <button
                className="close"
                aria-label="關閉"
                onClick={closePasswordChange}
              >
                ×
              </button>
            </header>
            <div className="modal-body vault-form">
              <p className="muted">
                先確認目前密碼，再用新密碼重新加密整個保管庫。
              </p>
              <label>
                <span>目前的主密碼</span>
                <input
                  aria-label="目前的主密碼"
                  type="password"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                />
              </label>
              <label>
                <span>新的主密碼</span>
                <input
                  aria-label="新的主密碼"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </label>
              <label>
                <span>再輸入一次新密碼</span>
                <input
                  aria-label="再輸入一次新密碼"
                  type="password"
                  autoComplete="new-password"
                  value={newPasswordAgain}
                  onChange={(e) => setNewPasswordAgain(e.target.value)}
                />
              </label>
              {newPassword && newPassword.length < 10 && (
                <p className="vault-error">新主密碼至少需要 10 個字元。</p>
              )}
              {newPasswordAgain && newPassword !== newPasswordAgain && (
                <p className="vault-error">兩次新密碼不一致。</p>
              )}
              {passwordChangeError && (
                <p className="vault-error">
                  {passwordChangeError}；原本的加密資料沒有被修改。
                </p>
              )}
            </div>
            <footer className="modal-actions">
              <button className="secondary" onClick={closePasswordChange}>
                取消
              </button>
              <button
                className="primary"
                disabled={
                  busy ||
                  !currentPassword ||
                  newPassword.length < 10 ||
                  newPassword !== newPasswordAgain
                }
                onClick={() => void updateMasterPassword()}
              >
                {busy ? "正在重新加密……" : "確認變更"}
              </button>
            </footer>
          </section>
        </div>
      )}
    </div>
  );
}
