import * as React from 'react';

export type FormFieldProps = {
  label?: string;
  hint?: string;
  error?: string;
  required?: boolean;
  /** id элемента управления, на который указывает подпись. */
  htmlFor?: string;
  className?: string;
  children?: React.ReactNode;
};

let counter = 0;

/**
 * Подпись, подсказка и ошибка вокруг любого элемента управления, который набор
 * не оборачивает: группы переключателей, ползунка, зоны загрузки. Ошибка
 * важнее подсказки — показываем только её, чтобы поле не спорило само с собой.
 */
export function FormField({
  label,
  hint,
  error,
  required = false,
  htmlFor,
  className,
  children,
}: FormFieldProps) {
  const fallbackId = React.useMemo(() => `ui-form-field-${++counter}`, []);
  const fieldId = htmlFor || fallbackId;
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const describedBy = error ? errorId : hint ? hintId : undefined;

  // Слот набора отдавал `describedBy` наружу: в React связь выставляется
  // сразу на элементе управления, если он её ещё не задал сам.
  const control =
    describedBy && React.isValidElement<{ 'aria-describedby'?: string }>(children)
      ? React.cloneElement(children, {
          'aria-describedby': children.props['aria-describedby'] ?? describedBy,
        })
      : children;

  return (
    <div className={className}>
      {label ? (
        htmlFor ? (
          <label
            htmlFor={htmlFor}
            className="mb-1.5 block text-xs uppercase tracking-widest text-ink-soft"
          >
            {label}
            {required ? (
              <span className="text-danger-text" aria-hidden="true">
                {' '}
                *
              </span>
            ) : null}
          </label>
        ) : (
          <span className="mb-1.5 block text-xs uppercase tracking-widest text-ink-soft">
            {label}
            {required ? (
              <span className="text-danger-text" aria-hidden="true">
                {' '}
                *
              </span>
            ) : null}
          </span>
        )
      ) : null}
      <div className="mt-1.5">{control}</div>
      {error ? (
        <p id={errorId} role="alert" className="mt-1.5 text-xs text-danger-text">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="mt-1.5 text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
