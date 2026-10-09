import { button, el } from './dom';

let closeCurrent: (() => void) | undefined;

/** Floating panel next to `anchor`. Closes on outside press / Escape. Returns its close function. */
export function openPopover(anchor: HTMLElement, build: (close: () => void) => HTMLElement, cls = ''): () => void {
  closeCurrent?.();
  const box = el('div', `popover ${cls}`, '', { 'data-testid': 'popover' });
  const close = (): void => {
    box.remove();
    document.removeEventListener('pointerdown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (closeCurrent === close) closeCurrent = undefined;
  };
  const onDown = (e: Event): void => {
    if (!box.contains(e.target as Node)) close();
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  box.append(build(close));
  document.body.append(box);
  const r = anchor.getBoundingClientRect();
  const w = box.offsetWidth;
  const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
  const below = r.bottom + 8 + box.offsetHeight < window.innerHeight;
  box.style.left = `${left}px`;
  box.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - box.offsetHeight)}px`;
  document.addEventListener('pointerdown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  closeCurrent = close;
  return close;
}

export const closePopover = (): void => closeCurrent?.();

function modal<T>(build: (done: (v: T | null) => void) => HTMLElement): Promise<T | null> {
  return new Promise((resolve) => {
    const dlg = el('dialog', 'dialog', '', { 'data-testid': 'dialog' });
    const done = (v: T | null): void => {
      dlg.close();
      dlg.remove();
      resolve(v);
    };
    dlg.addEventListener('cancel', () => done(null));
    dlg.append(build(done));
    document.body.append(dlg);
    dlg.showModal();
  });
}

/** Cancel + OK row; OK is returned so the caller can wire it (click or submit). */
function actionsRow(okLabel: string, cancel: () => void): { row: HTMLElement; ok: HTMLButtonElement } {
  const ok = button(okLabel, 'dialog-ok', 'primary');
  const cancelBtn = button('Cancel', 'dialog-cancel');
  cancelBtn.addEventListener('click', cancel);
  const row = el('div', 'dialog-actions');
  row.append(cancelBtn, ok);
  return { row, ok };
}

export const confirmDialog = (message: string, okLabel = 'OK'): Promise<boolean> =>
  modal<boolean>((done) => {
    const body = el('div', 'dialog-body');
    const { row, ok } = actionsRow(okLabel, () => done(null));
    ok.autofocus = true; // Enter confirms
    ok.addEventListener('click', () => done(true));
    body.append(el('p', '', message), row);
    return body;
  }).then((v) => v === true);

export interface Field {
  name: string;
  label: string;
  value: string;
  options?: [value: string, label: string][];
}

export const formDialog = (title: string, fields: Field[], okLabel = 'OK'): Promise<Record<string, string> | null> =>
  modal<Record<string, string>>((done) => {
    const form = el('form', 'dialog-body');
    form.append(el('h3', '', title));
    const inputs: Record<string, HTMLInputElement | HTMLSelectElement> = {};
    for (const f of fields) {
      const label = el('label', '', f.label);
      let input: HTMLInputElement | HTMLSelectElement;
      if (f.options) {
        input = el('select');
        for (const [v, l] of f.options) input.append(new Option(l, v));
      } else {
        input = el('input', '', '', { type: 'text' });
      }
      input.value = f.value;
      input.dataset.testid = `field-${f.name}`;
      inputs[f.name] = input;
      label.append(input);
      form.append(label);
    }
    const { row, ok } = actionsRow(okLabel, () => done(null));
    ok.type = 'submit';
    form.append(row);
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      done(Object.fromEntries(Object.entries(inputs).map(([k, i]) => [k, i.value])));
    });
    queueMicrotask(() => Object.values(inputs)[0]?.focus());
    return form;
  });
