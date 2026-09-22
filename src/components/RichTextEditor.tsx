import { useEffect, useRef, type ChangeEvent } from "react";

type Props = {
  html?: string;
  text?: string;
  onChange: (html: string, text: string) => void;
  compact?: boolean;
  ariaLabel?: string;
  placeholder?: string;
};

const escapeHtml = (value: string) =>
  value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
const textToHtml = (value: string) => escapeHtml(value).replaceAll("\n", "<br>");

export const sanitizeRichText = (value: string) => {
  if (!value) return "";
  const parser = new DOMParser();
  const parsed = parser.parseFromString(value, "text/html");
  const allowed = new Set(["BR", "B", "STRONG", "I", "EM", "U", "S", "STRIKE", "MARK", "SPAN", "P", "DIV"]);
  const walk = (node: Node) => [...node.childNodes].forEach((child) => {
    if (child.nodeType !== Node.ELEMENT_NODE) return;
    const element = child as HTMLElement;
    walk(element);
    if (!allowed.has(element.tagName)) {
      element.replaceWith(...[...element.childNodes]);
      return;
    }
    [...element.attributes].forEach((attribute) => {
      if (attribute.name !== "style") element.removeAttribute(attribute.name);
    });
    if (element.hasAttribute("style")) {
      const color = element.style.color;
      const background = element.style.backgroundColor;
      element.removeAttribute("style");
      if (color) element.style.color = color;
      if (background) element.style.backgroundColor = background;
    }
  });
  walk(parsed.body);
  return parsed.body.innerHTML;
};

export default function RichTextEditor({ html, text, onChange, compact = false, ariaLabel, placeholder }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const lastHtml = useRef("");
  const initialHtml = sanitizeRichText(html?.trim() || textToHtml(text || ""));
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || lastHtml.current === initialHtml) return;
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
  const command = (name: string, value?: string) => {
    editorRef.current?.focus();
    document.execCommand("styleWithCSS", false, "true");
    document.execCommand(name, false, value);
    emit();
  };
  const color = (event: ChangeEvent<HTMLInputElement>, name: string) => command(name, event.target.value);
  return <div className={`rich-text-editor ${compact ? "compact" : ""}`}>
    <div className="rich-text-toolbar" role="toolbar" aria-label="文字格式">
      <button type="button" title="粗體" onMouseDown={(event) => event.preventDefault()} onClick={() => command("bold")}>B</button>
      <button type="button" title="斜體" onMouseDown={(event) => event.preventDefault()} onClick={() => command("italic")}>I</button>
      <button type="button" title="底線" onMouseDown={(event) => event.preventDefault()} onClick={() => command("underline")}>U</button>
      <button type="button" title="刪除線" onMouseDown={(event) => event.preventDefault()} onClick={() => command("strikeThrough")}>S̶</button>
      <label title="文字顏色" className="rich-color">A<input aria-label="文字顏色" type="color" defaultValue="#5d4b86" onChange={(event) => color(event, "foreColor")} /></label>
      <label title="螢光筆顏色" className="rich-color highlight">▰<input aria-label="螢光筆顏色" type="color" defaultValue="#f5df72" onChange={(event) => color(event, "hiliteColor")} /></label>
    </div>
    <div ref={editorRef} className="rich-text-content" contentEditable role="textbox" aria-label={ariaLabel} data-placeholder={placeholder} suppressContentEditableWarning onInput={emit} />
  </div>;
}
