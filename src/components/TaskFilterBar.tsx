'use client';

// Конструктор фильтров в духе Asana: выбираешь поле, потом значение, условие
// садится чипом в строку. До этого фильтры были фиксированным рядом селектов,
// которые занимали место даже когда не нужны, и добавить поле было нельзя.
//
// В наборе @monos/ui меню состоит из данных, а вложенных подменю и пунктов с
// галочками в нём нет. Поэтому фильтр собран из примитивов: чип для условия,
// панель (Popover) со списком полей и значениями. Мультивыбор живёт в панели,
// поэтому она не закрывается при выборе.

import { ChevronLeft, Filter, Plus } from 'lucide-react';
import { useState } from 'react';
import { Badge } from '@/components/monos/Badge';
import { Button } from '@/components/monos/Button';
import { Checkbox } from '@/components/monos/Checkbox';
import { Chip } from '@/components/monos/Chip';
import { Popover } from '@/components/monos/Popover';
import { Separator } from '@/components/monos/Separator';
import { toolbarControl } from '@/components/monos/toolbar';
import {
  splitValues as splitFilterValues,
  type FilterField,
  type FilterFieldKey,
  type FilterPreset,
  type FilterValues,
} from '@/lib/task-filters';

export type {
  FilterField,
  FilterFieldKey,
  FilterOption,
  FilterPreset,
  FilterValues,
} from '@/lib/task-filters';
export { splitValues } from '@/lib/task-filters';

function optionLabel(field: FilterField, value: string): string {
  if (!field.multi) return field.options.find((option) => option.value === value)?.label || value;
  const selected = splitFilterValues(value, field.empty);
  const first = field.options.find((option) => option.value === selected[0])?.label || selected[0];
  return selected.length > 1 ? `${first} +${selected.length - 1}` : first;
}

function toggleValue(field: FilterField, current: string, option: string): string {
  const selected = splitFilterValues(current, field.empty);
  const next = selected.includes(option)
    ? selected.filter((item) => item !== option)
    : [...selected, option];
  return next.length ? next.join(',') : field.empty;
}

export default function TaskFilterBar({
  fields,
  values,
  presets,
  activePreset,
  onChange,
  onApplyPreset,
  onReset,
  stacked = false,
}: {
  fields: FilterField[];
  values: FilterValues;
  presets?: FilterPreset[];
  activePreset?: string;
  onChange: (key: FilterFieldKey, value: string) => void;
  onApplyPreset?: (preset: FilterPreset) => void;
  onReset: () => void;
  /** На телефоне контролы идут колонкой во всю ширину. */
  stacked?: boolean;
}) {
  // Вложенное подменю уезжало за правый край экрана на телефоне, поэтому
  // значения выбранного поля показываются в той же панели: список полей
  // сменяется списком значений.
  const [drill, setDrill] = useState<FilterFieldKey | null>(null);
  const drillField = fields.find((field) => field.key === drill);

  const active = fields.filter((field) => values[field.key] !== field.empty);
  // В панели держим все поля, а не только незанятые: иначе после первой галочки
  // поле уходило из списка и отметить второе значение было нельзя.
  const available = fields;

  const valueRows = (field: FilterField) =>
    field.options.map((option) => {
      const checked = field.multi
        ? splitFilterValues(values[field.key], field.empty).includes(option.value)
        : values[field.key] === option.value;
      return (
        // Не label: галка приносит свой, а вложенные label браузер считает
        // некорректной разметкой и имя получается не тем.
        <div
          key={option.value}
          className="flex min-h-8 cursor-pointer items-center gap-2 rounded-ui px-1 py-1 text-sm text-ink-soft hover:text-ink"
        >
          <Checkbox
            checked={checked}
            ariaLabel={option.label}
            onChange={() =>
              onChange(
                field.key,
                field.multi ? toggleValue(field, values[field.key], option.value) : option.value,
              )
            }
          />
          <span className="min-w-0 flex-1 truncate">{option.label}</span>
          {option.hint ? <span className="text-whisper text-ink-faint">{option.hint}</span> : null}
        </div>
      );
    });

  return (
    <div className={stacked ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-2'}>
      {presets?.length ? (
        <div className={stacked ? 'flex flex-wrap gap-2' : 'flex items-center gap-1.5'}>
          {presets.map((preset) => (
            <Button
              key={preset.id}
              variant={activePreset === preset.id ? 'secondary' : 'quiet'}
              size="sm"
              className={toolbarControl}
              onClick={() => onApplyPreset?.(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      ) : null}

      {active.map((field) => (
        <Chip
          key={field.key}
          tone="accent"
          size="md"
          removable
          removeLabel={`Убрать фильтр «${field.label}»`}
          onRemove={() => onChange(field.key, field.empty)}
        >
          {field.toggle ? field.label : `${field.label}: ${optionLabel(field, values[field.key])}`}
        </Chip>
      ))}

      <Popover
        onOpenChange={(open) => {
          if (!open) setDrill(null);
        }}
        trigger={
          <Button
            variant="secondary"
            size="sm"
            className={`${toolbarControl} ${stacked ? 'w-full justify-center' : ''}`}
            icon={<Plus size={14} strokeWidth={1.7} />}
          >
            Фильтр
          </Button>
        }
      >
        <div className="w-72 max-w-[calc(100vw-2rem)]">
          {drillField ? (
            <>
              <button
                type="button"
                onClick={() => setDrill(null)}
                className="flex min-h-8 w-full items-center gap-2 rounded-ui px-1 text-xs font-bold uppercase tracking-widest text-ink-soft transition-colors duration-fast hover:text-ink"
              >
                <ChevronLeft size={14} strokeWidth={1.7} />
                {drillField.label}
              </button>
              <Separator className="my-1" />
              <div className="flex flex-col gap-0.5">{valueRows(drillField)}</div>
            </>
          ) : (
            <>
              <p className="px-1 py-1 text-xs font-bold uppercase tracking-widest text-ink-faint">
                Фильтровать по полю
              </p>
              <Separator className="my-1" />
              <div className="flex flex-col gap-0.5">
                {available.map((field) =>
                  field.toggle ? (
                    <button
                      key={field.key}
                      type="button"
                      onClick={() => onChange(field.key, field.options[0]?.value ?? '')}
                      className="flex min-h-8 w-full items-center rounded-ui px-2 text-left text-sm text-ink-soft transition-colors duration-fast hover:bg-surface hover:text-ink"
                    >
                      {field.label}
                    </button>
                  ) : (
                    <button
                      key={field.key}
                      type="button"
                      onClick={() => setDrill(field.key)}
                      className="flex min-h-8 w-full items-center rounded-ui px-2 text-left text-sm text-ink-soft transition-colors duration-fast hover:bg-surface hover:text-ink"
                    >
                      {field.label}
                    </button>
                  ),
                )}
              </div>
            </>
          )}
        </div>
      </Popover>

      {active.length > 0 ? (
        <Button
          variant="quiet"
          size="sm"
          className={`${toolbarControl} ${stacked ? 'w-full' : ''} text-ink-soft`}
          onClick={onReset}
          icon={<Filter size={14} strokeWidth={1.7} />}
          trailing={<Badge tone="neutral">{active.length}</Badge>}
        >
          Сбросить
        </Button>
      ) : null}
    </div>
  );
}
