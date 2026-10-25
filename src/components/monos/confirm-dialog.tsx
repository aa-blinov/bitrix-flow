'use client';

// Подтверждение опасного действия. window.confirm выглядел чужеродно,
// особенно на телефоне, и не позволял назвать кнопку по делу.

import { createContext, useCallback, useContext, useState } from 'react';
import { AlertDialog } from './AlertDialog';
import { t } from '@/lib/i18n';

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
      <AlertDialog
        open={Boolean(pending)}
        onCancel={() => close(false)}
        onConfirm={() => close(true)}
        title={pending?.title}
        description={pending?.description}
        confirmLabel={pending?.confirmLabel || t('Подтвердить')}
        cancelLabel={pending?.cancelLabel || t('Отмена')}
        tone={pending?.destructive ? 'danger' : 'primary'}
      />
    </ConfirmContext.Provider>
  );
}
