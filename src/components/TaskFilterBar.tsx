'use client';

// Конструктор фильтров в духе Asana: выбираешь поле, потом значение, условие
// садится чипом в строку. До этого фильтры были фиксированным рядом селектов,
// которые занимали место даже когда не нужны, и добавить поле было нельзя.

import { Check, Filter, Plus, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { toolbarControl } from '@/components/ui/toolbar';

export type FilterFieldKey =
  'status' | 'assignee' | 'project' | 'tag' | 'priority' | 'deadline' | 'hideDone';

export type FilterOption = { value: string; label: string; hint?: string };

export type FilterField = {
  key: FilterFieldKey;
  label: string;
  /** Значение «фильтр не задан»: чип для него не показываем. */
  empty: string;
  options: FilterOption[];
  /** Поле-переключатель: выбирается без списка значений. */
  toggle?: boolean;
};

export type FilterValues = Record<FilterFieldKey, string>;

export type FilterPreset = {
  id: string;
  label: string;
  values: Partial<FilterValues>;
};

function optionLabel(field: FilterField, value: string): string {
  return field.options.find((option) => option.value === value)?.label || value;
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
  const active = fields.filter((field) => values[field.key] !== field.empty);
  const available = fields.filter((field) => values[field.key] === field.empty);

  return (
    <div className={stacked ? 'flex flex-col gap-2' : 'flex flex-wrap items-center gap-2'}>
      {presets?.length ? (
        <div className={stacked ? 'flex flex-wrap gap-2' : 'flex items-center gap-1.5'}>
          {presets.map((preset) => (
            <Button
              key={preset.id}
              variant={activePreset === preset.id ? 'secondary' : 'outline'}
              size="sm"
              className={toolbarControl}
              onClick={() => onApplyPreset?.(preset)}
            >
              {preset.label}
            </Button>
          ))}
        </div>
      ) : null}

      {active.map((field) =>
        field.toggle ? (
          <Button
            key={field.key}
            variant="secondary"
            size="sm"
            className={`${toolbarControl} ${stacked ? 'w-full justify-between' : ''} gap-1.5`}
            onClick={() => onChange(field.key, field.empty)}
            aria-label={`Убрать фильтр «${field.label}»`}
          >
            <span>{field.label}</span>
            <X className="size-3" />
          </Button>
        ) : (
          <DropdownMenu key={field.key}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className={`${toolbarControl} ${stacked ? 'w-full justify-start' : ''} gap-1.5`}
                aria-label={field.label}
              >
                <span className="text-muted-foreground">{field.label}:</span>
                {/* На узком экране значение прижимаем к названию, а крестик
                    к правому краю: иначе оно болталось посередине кнопки. */}
                <span className={stacked ? 'flex-1 truncate text-left' : 'max-w-40 truncate'}>
                  {optionLabel(field, values[field.key])}
                </span>
                <span
                  role="button"
                  tabIndex={0}
                  aria-label={`Убрать фильтр «${field.label}»`}
                  className="-mr-1 ml-0.5 rounded p-0.5 hover:bg-background/60"
                  onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onChange(field.key, field.empty);
                  }}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    onChange(field.key, field.empty);
                  }}
                >
                  <X className="size-3" />
                </span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
              <DropdownMenuLabel>{field.label}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {field.options.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={values[field.key] === option.value}
                  onCheckedChange={() => onChange(field.key, option.value)}
                >
                  {option.label}
                  {option.hint ? (
                    <span className="ml-1 text-muted-foreground">{option.hint}</span>
                  ) : null}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      )}

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={`${toolbarControl} ${stacked ? 'w-full justify-center' : ''}`}
            disabled={available.length === 0}
          >
            <Plus size={14} />
            Фильтр
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuLabel>Фильтровать по полю</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {available.map((field) =>
            field.toggle ? (
              <DropdownMenuItem
                key={field.key}
                onClick={() => onChange(field.key, field.options[0]?.value ?? '')}
              >
                <Check className="size-4 opacity-0" />
                {field.label}
              </DropdownMenuItem>
            ) : (
              <DropdownMenuSub key={field.key}>
                <DropdownMenuSubTrigger>{field.label}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                  {field.options.map((option) => (
                    <DropdownMenuItem
                      key={option.value}
                      onClick={() => onChange(field.key, option.value)}
                    >
                      {option.label}
                      {option.hint ? (
                        <span className="ml-1 text-muted-foreground">{option.hint}</span>
                      ) : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ),
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {active.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className={`${toolbarControl} ${stacked ? 'w-full' : ''} text-muted-foreground`}
          onClick={onReset}
        >
          <Filter size={14} />
          Сбросить
          <Badge variant="secondary">{active.length}</Badge>
        </Button>
      )}
    </div>
  );
}
