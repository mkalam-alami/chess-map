import { atom, useAtom } from './hooks';

const state = atom({ text: '', shown: false });
let timer: ReturnType<typeof setTimeout> | undefined;

export function toast(message: string, ms = 2200): void {
  state.set({ text: message, shown: true });
  clearTimeout(timer);
  timer = setTimeout(() => state.set({ ...state.get(), shown: false }), ms);
}

/** Hides the toast now (e.g. a "Syncing…" that no longer applies). */
export function dismissToast(): void {
  clearTimeout(timer);
  state.set({ ...state.get(), shown: false });
}

export function ToastHost() {
  const { text, shown } = useAtom(state);
  return <div class={shown ? 'toast show' : 'toast'} data-testid="toast" role="status">{text}</div>;
}
