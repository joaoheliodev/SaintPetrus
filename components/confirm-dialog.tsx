'use client';
// Every "are you sure?" of the panel, in the app instead of the browser's native dialog. The text of each question is
// unchanged; the first sentence becomes the title. Focus starts on Cancel, so Enter never confirms by accident.
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { AlertDialog } from '@base-ui/react/alert-dialog';
import { Button } from './ui/button';

export type ConfirmRequest = { message: string; confirmLabel: string; destructive?: boolean };
export type Pending = ConfirmRequest & { resolve: (answer: boolean) => void };
// A newer question replaces an unanswered one, which counts as refused.
export function nextQuestion(current: Pending | null, next: Pending) { current?.resolve(false); return next; }
// Without a provider nothing can be confirmed, so the safe answer is no.
const ConfirmContext = createContext<(request: ConfirmRequest) => Promise<boolean>>(async () => false);
export const useConfirm = () => useContext(ConfirmContext);

export function splitQuestion(message: string) {
  const end = message.indexOf('?');
  return end < 0 ? { title: message, detail: '' } : { title: message.slice(0, end + 1), detail: message.slice(end + 1).trim() };
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const confirm = useCallback((request: ConfirmRequest) => new Promise<boolean>(resolve => {
    setPending(current => nextQuestion(current, { ...request, resolve }));
  }), []);
  const settle = (answer: boolean) => { pending?.resolve(answer); setPending(null); };
  const { title, detail } = splitQuestion(pending?.message ?? '');
  return <ConfirmContext.Provider value={confirm}>{children}
    <AlertDialog.Root open={!!pending} onOpenChange={open => { if (!open) settle(false); }}>
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="confirm-backdrop" />
        <AlertDialog.Popup className="confirm-dialog" initialFocus={cancel} data-confirm="">
          <AlertDialog.Title className="confirm-title">{title}</AlertDialog.Title>
          {detail && <AlertDialog.Description className="confirm-detail">{detail}</AlertDialog.Description>}
          <div className="project-actions confirm-actions">
            <Button ref={cancel} variant="outline" onClick={() => settle(false)}>Cancel</Button>
            <Button variant={pending?.destructive ? 'destructive' : 'default'} onClick={() => settle(true)}>{pending?.confirmLabel}</Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  </ConfirmContext.Provider>;
}
