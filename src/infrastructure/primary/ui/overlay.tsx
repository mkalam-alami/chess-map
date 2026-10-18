import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useRef } from 'preact/hooks';
import { atom, useAtom } from './hooks';

interface PopoverState {
  anchor: HTMLElement;
  build: (close: () => void) => ComponentChildren;
  cls: string;
  id: number;
}

let popoverSeq = 0;
const popover = atom<PopoverState | null>(null);

/** Floating panel next to `anchor`. Closes on outside press / Escape. Only one is open at a time. */
export const openPopover = (anchor: HTMLElement, build: PopoverState['build'], cls = ''): void => popover.set({ anchor, build, cls, id: ++popoverSeq });

export const closePopover = (): void => {
  if (popover.get()) popover.set(null);
};

function Popover({ anchor, build, cls }: PopoverState) {
  const box = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const b = box.current as HTMLDivElement;
    const r = anchor.getBoundingClientRect();
    const w = b.offsetWidth;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2));
    const below = r.bottom + 8 + b.offsetHeight < window.innerHeight;
    b.style.left = `${left}px`;
    b.style.top = `${below ? r.bottom + 8 : Math.max(8, r.top - 8 - b.offsetHeight)}px`;
  }, []);
  useEffect(() => {
    const onDown = (e: Event): void => {
      if (!box.current?.contains(e.target as Node)) closePopover();
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') closePopover();
    };
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
    };
  }, []);
  return <div ref={box} class={`popover ${cls}`} data-testid="popover">{build(closePopover)}</div>;
}

interface DialogState {
  body: ComponentChildren;
  cancel: () => void;
}

const dialog = atom<DialogState | null>(null);

function modal<T>(build: (done: (v: T | null) => void) => ComponentChildren): Promise<T | null> {
  return new Promise((resolve) => {
    const done = (v: T | null): void => {
      dialog.set(null);
      resolve(v);
    };
    dialog.set({ body: build(done), cancel: () => done(null) });
  });
}

function Dialog({ body, cancel }: DialogState) {
  const ref = useRef<HTMLDialogElement>(null);
  // Layout effect: the dialog must be open (and focused) before the next key press, not after the next frame.
  useLayoutEffect(() => {
    const d = ref.current as HTMLDialogElement;
    d.showModal();
    d.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    return () => d.close();
  }, []);
  return <dialog ref={ref} class="dialog" data-testid="dialog" onCancel={cancel}>{body}</dialog>;
}

/** Renders the open popover and dialog (at most one of each). Mounted once, see App. */
export function OverlayHost() {
  const p = useAtom(popover);
  const d = useAtom(dialog);
  return (
    <>
      {p && <Popover key={p.id} {...p} />}
      {d && <Dialog {...d} />}
    </>
  );
}

/** Cancel + OK row. Without `onOk` the OK button submits the surrounding form. */
function Actions({ okLabel, cancel, onOk }: { okLabel: string; cancel: () => void; onOk?: () => void }) {
  return (
    <div class="dialog-actions">
      <button type="button" data-testid="dialog-cancel" onClick={cancel}>Cancel</button>
      <button type={onOk ? 'button' : 'submit'} class="primary" data-testid="dialog-ok" data-autofocus={onOk ? '' : undefined} onClick={onOk}>{okLabel}</button>
    </div>
  );
}

export const confirmDialog = (message: string, okLabel = 'OK'): Promise<boolean> =>
  modal<boolean>((done) => (
    <div class="dialog-body">
      <p>{message}</p>
      <Actions okLabel={okLabel} cancel={() => done(null)} onOk={() => done(true)} />
    </div>
  )).then((v) => v === true);

export interface Field {
  name: string;
  label: string;
  value: string;
  options?: [value: string, label: string][];
}

function FormBody({ title, fields, okLabel, done }: { title: string; fields: Field[]; okLabel: string; done: (v: Record<string, string> | null) => void }) {
  return (
    <form
      class="dialog-body"
      onSubmit={(e) => {
        e.preventDefault();
        done(Object.fromEntries([...new FormData(e.currentTarget)].map(([k, v]) => [k, String(v)])));
      }}
    >
      <h3>{title}</h3>
      {fields.map((f, i) => (
        <label>
          {f.label}
          {f.options ? (
            <select name={f.name} value={f.value} data-testid={`field-${f.name}`} data-autofocus={i === 0 ? '' : undefined}>
              {f.options.map(([v, l]) => <option value={v}>{l}</option>)}
            </select>
          ) : (
            <input type="text" name={f.name} value={f.value} data-testid={`field-${f.name}`} data-autofocus={i === 0 ? '' : undefined} />
          )}
        </label>
      ))}
      <Actions okLabel={okLabel} cancel={() => done(null)} />
    </form>
  );
}

export const formDialog = (title: string, fields: Field[], okLabel = 'OK'): Promise<Record<string, string> | null> =>
  modal<Record<string, string>>((done) => <FormBody title={title} fields={fields} okLabel={okLabel} done={done} />);

/** A read-only dialog with a title, scrollable content and a Close button. */
export const infoDialog = (title: string, content: ComponentChildren, cls = ''): Promise<null> =>
  modal<null>((done) => (
    <div class={`dialog-body ${cls}`}>
      <h3>{title}</h3>
      <div class="dialog-scroll">{content}</div>
      <div class="dialog-actions">
        <button type="button" class="primary" data-testid="dialog-ok" data-autofocus onClick={() => done(null)}>Close</button>
      </div>
    </div>
  ));
