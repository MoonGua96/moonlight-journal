import { useEffect, useRef, useState, type ChangeEvent, type CSSProperties } from "react";

type Props = {
  html?: string;
  text?: string;
  onChange: (html: string, text: string) => void;
  compact?: boolean;
  ariaLabel?: string;
  placeholder?: string;
  contextualToolbar?: boolean;
};

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const textToHtml = (value: string) =>
  escapeHtml(value).replaceAll("\n", "<br>");

/** Keep saved journal markup intentionally small and local-only. */
export const sanitizeRichText = (value: string) => {
  if (!value) return "";
  const parser = new DOMParser();
  const documentFragment = parser.parseFromString(value, "text/html");
  const allowed = new Set([
    "BR",
    "B",
    "STRONG",
    "I",
    "EM",
    "U",
    "S",
    "STRIKE",
    "MARK",
    "SPAN",
    "P",
    "DIV",
    "FONT",
  ]);
  const allowedStyles = [
    "color",
    "background-color",
    "font-weight",
    "font-style",
    "text-decoration",
    "text-decoration-line",
  ];
  const safeStyleValue = (styleValue: string) =>
    styleValue.length < 160 && !/[;{}]/.test(styleValue) && !/url\s*\(/i.test(styleValue);
  const walk = (node: Node) => {
    [...node.childNodes].forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) {
        const element = child as HTMLElement;
        walk(element);
        if (!allowed.has(element.tagName)) {
          element.replaceWith(...[...element.childNodes]);
          return;
        }
        [...element.attributes].forEach((attribute) => {
          if (attribute.name !== "style" && attribute.name !== "color") {
            element.removeAttribute(attribute.name);
          }
        });
        const legacyColor = element.getAttribute("color");
        const styles = allowedStyles
          .map((property) => [property, element.style.getPropertyValue(property)] as const)
          .filter(([, styleValue]) => Boolean(styleValue) && safeStyleValue(styleValue));
        if (
          legacyColor &&
          !styles.some(([property]) => property === "color") &&
          safeStyleValue(legacyColor)
        ) {
          styles.push(["color", legacyColor]);
        }
        element.removeAttribute("style");
        element.removeAttribute("color");
        styles.forEach(([property, styleValue]) => element.style.setProperty(property, styleValue));
      }
    });
  };
  walk(documentFragment.body);
  return documentFragment.body.innerHTML;
};

export default function RichTextEditor({
  html,
  text,
  onChange,
  compact = false,
  ariaLabel,
  placeholder,
  contextualToolbar = false,
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastHtml = useRef("");
  const selectionRef = useRef<Range | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState<{ left: number; top: number } | null>(null);
  const initialHtml = sanitizeRichText(html?.trim() || textToHtml(text || ""));

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    if (lastHtml.current === initialHtml) return;
    if (editor.innerHTML !== initialHtml) editor.innerHTML = initialHtml;
    lastHtml.current = initialHtml;
  }, [initialHtml]);

  const emit = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const clean = sanitizeRichText(editor.innerHTML);
    if (editor.innerHTML !== clean) editor.innerHTML = clean;
    lastHtml.current = clean;
    onChange(clean, (editor.innerText || editor.textContent || "").replace(/\u00a0/g, " "));
  };
  const rememberSelection = () => {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (
      !editor ||
      !selection ||
      selection.rangeCount === 0 ||
      !selection.anchorNode ||
      !editor.contains(selection.anchorNode)
    ) return;
    selectionRef.current = selection.getRangeAt(0).cloneRange();
  };
  const updateToolbarPosition = () => {
    if (!contextualToolbar) return;
    const editor = editorRef.current;
    const wrapper = editor?.parentElement;
    const selection = window.getSelection();
    if (!editor || !wrapper || !selection || selection.rangeCount === 0 || !selection.anchorNode || !editor.contains(selection.anchorNode)) {
      setToolbarPosition(null);
      return;
    }
    const range = selection.getRangeAt(0);
    if (range.collapsed || !range.toString()) {
      setToolbarPosition(null);
      return;
    }
    selectionRef.current = range.cloneRange();
    const selectionRect = range.getBoundingClientRect();
    const wrapperRect = wrapper.getBoundingClientRect();
    const left = Math.max(0, Math.min(wrapperRect.width - 180, selectionRect.left - wrapperRect.left + selectionRect.width / 2 - 85));
    const above = selectionRect.top - wrapperRect.top - 48;
    const top = above >= 0 ? above : selectionRect.bottom - wrapperRect.top + 7;
    setToolbarPosition({ left, top });
  };
  useEffect(() => {
    if (!contextualToolbar) return;
    const refresh = () => updateToolbarPosition();
    document.addEventListener("selectionchange", refresh);
    window.addEventListener("resize", refresh);
    return () => {
      document.removeEventListener("selectionchange", refresh);
      window.removeEventListener("resize", refresh);
    };
  }, [contextualToolbar]);
  const restoreSelection = () => {
    const editor = editorRef.current;
    const range = selectionRef.current;
    if (
      !editor ||
      !range ||
      !editor.contains(range.startContainer) ||
      !editor.contains(range.endContainer)
    ) return;
    const selection = window.getSelection();
    if (!selection) return;
    selection.removeAllRanges();
    selection.addRange(range);
  };
  const command = (name: string, value?: string) => {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    restoreSelection();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(name, false, value);
    emit();
    rememberSelection();
    window.requestAnimationFrame(updateToolbarPosition);
  };
  const color = (event: ChangeEvent<HTMLInputElement>, name: string) => {
    command(name, event.target.value);
  };
  const toolbarStyle: CSSProperties | undefined = contextualToolbar && toolbarPosition
    ? { left: toolbarPosition.left, top: toolbarPosition.top }
    : undefined;

  return (
    <div className={["rich-text-editor", compact && "compact", contextualToolbar && "contextual"].filter(Boolean).join(" ")}>
      <div
        className={["rich-text-toolbar", contextualToolbar && "selection-toolbar", contextualToolbar && !toolbarPosition && "hidden"].filter(Boolean).join(" ")}
        role="toolbar"
        aria-label="文字格式"
        style={toolbarStyle}
        onMouseDown={(event) => { if ((event.target as HTMLElement).tagName !== "INPUT") event.preventDefault(); }}
      >
        <button type="button" title="粗體" onMouseDown={(event) => { rememberSelection(); event.preventDefault(); }} onClick={() => command("bold")}>B</button>
        <button type="button" title="斜體" onMouseDown={(event) => { rememberSelection(); event.preventDefault(); }} onClick={() => command("italic")}>I</button>
        <button type="button" title="底線" onMouseDown={(event) => { rememberSelection(); event.preventDefault(); }} onClick={() => command("underline")}>U</button>
        <button type="button" title="刪除線" onMouseDown={(event) => { rememberSelection(); event.preventDefault(); }} onClick={() => command("strikeThrough")}>S̶</button>
        <label title="文字顏色" className="rich-color">
          A<input aria-label="文字顏色" type="color" defaultValue="#5d4b86" onMouseDown={rememberSelection} onChange={(event) => color(event, "foreColor")} />
        </label>
        <label title="螢光筆顏色" className="rich-color highlight">
          ▰<input aria-label="螢光筆顏色" type="color" defaultValue="#f5df72" onMouseDown={rememberSelection} onChange={(event) => color(event, "hiliteColor")} />
        </label>
      </div>
      <div
        ref={editorRef}
        className="rich-text-content"
        contentEditable
        role="textbox"
        aria-label={ariaLabel}
        data-placeholder={placeholder}
        suppressContentEditableWarning
        onInput={emit}
        onMouseUp={() => { rememberSelection(); updateToolbarPosition(); }}
        onKeyUp={() => { rememberSelection(); updateToolbarPosition(); }}
        onFocus={() => { rememberSelection(); updateToolbarPosition(); }}
      />
    </div>
  );
}
