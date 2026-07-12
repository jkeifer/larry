// Small, shared DOM-construction helpers. Kept in one leaf module so both the
// viewer (content.ts) and the extracted feature controllers (find.ts) build
// identical elements without duplicating the boilerplate.

export function text(t: string, cls: string): HTMLSpanElement {
  const s = document.createElement("span");
  s.className = cls;
  s.textContent = t;
  return s;
}

export function button(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "jv-btn";
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

export function spacer(): HTMLElement {
  const s = document.createElement("span");
  s.className = "jv-spacer";
  return s;
}

export function flash(btn: HTMLButtonElement, msg: string): void {
  const prev = btn.textContent;
  btn.textContent = msg;
  setTimeout(() => (btn.textContent = prev), 1200);
}
