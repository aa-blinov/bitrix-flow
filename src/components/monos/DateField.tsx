'use client';

import * as React from 'react';
import { Calendar } from 'lucide-react';
import { TextField, type TextFieldProps } from './TextField';
import { t } from '@/lib/i18n';
import { cn } from '@/lib/utils';

// Нативного календаря у поля нет: значение набирают в маску, ДД.ММ.ГГГГ, а значение
// наружу остаётся ISO, как у нативного: YYYY-MM-DD или, со временем, YYYY-MM-DDTHH:mm.

export type DateFieldProps = Omit<TextFieldProps, 'type' | 'value' | 'onChange' | 'placeholder'> & {
  value: string;
  onChange: (value: string) => void;
  withTime?: boolean;
  /** Подпись пустого поля. По умолчанию маска: в плотной таблице она шумит в каждой строке. */
  placeholder?: string;
};

function show(iso: string, withTime: boolean): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso || '');
  if (!match) return '';
  const date = `${match[3]}.${match[2]}.${match[1]}`;
  return withTime && match[4] ? `${date} ${match[4]}:${match[5]}` : date;
}

/** Цифры в маску: ДД.ММ.ГГГГ, а со временем ещё ЧЧ:ММ. */
function mask(raw: string, withTime: boolean): string {
  const d = raw.replace(/\D/g, '').slice(0, withTime ? 12 : 8);
  let out = d.slice(0, 2);
  if (d.length > 2) out += `.${d.slice(2, 4)}`;
  if (d.length > 4) out += `.${d.slice(4, 8)}`;
  if (d.length > 8) out += ` ${d.slice(8, 10)}`;
  if (d.length > 10) out += `:${d.slice(10, 12)}`;
  return out;
}

/** ISO из полностью набранной даты, иначе null. Несуществующая дата (31.02) не проходит. */
function parse(text: string, withTime: boolean): string | null {
  const d = text.replace(/\D/g, '');
  if (d.length !== (withTime ? 12 : 8)) return null;
  const day = Number(d.slice(0, 2));
  const month = Number(d.slice(2, 4));
  const year = Number(d.slice(4, 8));
  const probe = new Date(year, month - 1, day);
  if (probe.getFullYear() !== year || probe.getMonth() !== month - 1 || probe.getDate() !== day)
    return null;
  const date = `${d.slice(4, 8)}-${d.slice(2, 4)}-${d.slice(0, 2)}`;
  if (!withTime) return date;
  const hours = Number(d.slice(8, 10));
  const minutes = Number(d.slice(10, 12));
  if (hours > 23 || minutes > 59) return null;
  return `${date}T${d.slice(8, 10)}:${d.slice(10, 12)}`;
}

// Высоты повторяют ступени TextField.
const BUTTON_HEIGHT = { sm: 'h-7', md: 'h-9', lg: 'h-11' } as const;

export function DateField({
  value,
  onChange,
  withTime = false,
  size = 'md',
  className,
  onBlur,
  placeholder,
  ...props
}: DateFieldProps) {
  const [text, setText] = React.useState(() => show(value, withTime));
  // Скрытый нативный input держит значение и умеет открывать системный выбор
  // даты: showPicker вызывается с кнопки, из основного поля он бы уводил фокус.
  const pickerRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    setText((current) => (parse(current, withTime) === value ? current : show(value, withTime)));
  }, [value, withTime]);

  const change = (raw: string) => {
    const next = mask(raw, withTime);
    setText(next);
    if (next === '') onChange('');
    else {
      const iso = parse(next, withTime);
      if (iso) onChange(iso);
    }
  };

  return (
    // self-center: в grid ячейка по умолчанию тянется на высоту строки. Высоту
    // обёртке снаружи не задавай: поле внутри остаётся своей ступени, прижимается
    // к верху и встаёт выше соседей, а календарь съезжает с его центра.
    <div className={cn('relative self-center', className)}>
      <TextField
        {...props}
        size={size}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        placeholder={placeholder ?? (withTime ? t('ДД.ММ.ГГГГ ЧЧ:ММ') : t('ДД.ММ.ГГГГ'))}
        value={text}
        onChange={(event) => change(event.target.value)}
        onBlur={(event) => {
          // Недонабранную дату возвращаем к последнему верному значению.
          if (parse(text, withTime) === null && text !== '') setText(show(value, withTime));
          onBlur?.(event);
        }}
        className="[&_input]:pr-9"
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={t('Открыть календарь')}
        title={t('Открыть календарь')}
        // mousedown не отдаём браузеру: иначе нажатие уводит фокус с поля и
        // его onBlur возвращал недонабранную дату к прежнему значению.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          // Нативный селектор даты: showPicker есть не везде, тогда фокус в поле.
          const input = pickerRef.current;
          try {
            input?.showPicker?.();
          } catch {
            input?.focus();
          }
        }}
        // Кнопка прижата к низу и высотой с само поле: на всю обёртку она захватывала и
        // подпись над полем, и календарь у полей с подписью вставал выше центра поля.
        className={cn(
          'absolute right-0 bottom-0 flex w-8 items-center justify-center text-ink-soft transition-colors duration-fast hover:text-ink max-sm:h-11 max-sm:w-11',
          BUTTON_HEIGHT[size],
        )}
      >
        <Calendar size={14} strokeWidth={1.7} aria-hidden="true" />
      </button>
      <input
        ref={pickerRef}
        type={withTime ? 'datetime-local' : 'date'}
        value={value}
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => event.target.value && change(show(event.target.value, withTime))}
        className="pointer-events-none absolute right-0 bottom-0 size-px opacity-0"
      />
    </div>
  );
}
