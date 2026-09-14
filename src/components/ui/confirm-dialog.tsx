'use client';

// Подтверждение опасного действия в стиле приложения. window.confirm выглядел
// чужеродно, особенно на телефоне, и не позволял назвать кнопку по делу.
import { createContext, useCallback, useContext, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

const ConfirmContext = createContext<(options: ConfirmOptions) => Promise<boolean>>(
  async () => false,
);

export function useConfirm() {
  return useContext(ConfirmContext);
}

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => setPending({ ...options, resolve })),
    [],
  );

  const close = (value: boolean) => {
    pending?.resolve(value);
    setPending(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && close(false)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{pending?.title}</DialogTitle>
          </DialogHeader>
          {pending?.description && (
            <p className="text-sm text-muted-foreground">{pending.description}</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => close(false)}>
              {pending?.cancelLabel || 'Отмена'}
            </Button>
            <Button
              variant={pending?.destructive ? 'destructive' : 'default'}
              onClick={() => close(true)}
              autoFocus
            >
              {pending?.confirmLabel || 'Подтвердить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmContext.Provider>
  );
}
