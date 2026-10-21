'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Button } from './Button';
import { Modal } from './Modal';

/**
 * Подтверждение того, что нельзя отменить. Это alertdialog: без крестика и
 * без закрытия по фону, а фокус сначала на «Отмене» — безопасный выбор должен
 * быть самым простым.
 */
export type AlertDialogProps = {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: 'danger' | 'primary';
  loading?: boolean;
  closeOnConfirm?: boolean;
  closeOnEscape?: boolean;
  className?: string;
  children?: React.ReactNode;
};

export function AlertDialog({
  open,
  onCancel,
  onConfirm,
  title = '',
  description = '',
  confirmLabel = 'Подтвердить',
  cancelLabel = 'Отмена',
  tone = 'danger',
  loading = false,
  closeOnConfirm = true,
  closeOnEscape = true,
  className,
  children,
}: AlertDialogProps) {
  const cancelButton = React.useRef<HTMLButtonElement | null>(null);

  return (
    <Modal
      open={open}
      onClose={onCancel}
      role="alertdialog"
      title={title}
      description={description}
      closeOnEscape={closeOnEscape && !loading}
      closeOnBackdrop={false}
      showClose={false}
      initialFocus={cancelButton}
      className={className}
      footer={
        <>
          <Button variant="secondary" disabled={loading} onClick={onCancel} ref={cancelButton}>
            {cancelLabel}
          </Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={loading}
            onClick={() => {
              onConfirm();
              if (closeOnConfirm && !loading) onCancel();
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  );
}
