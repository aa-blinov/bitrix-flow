'use client';

// Конструктор фильтров в духе Asana: выбираешь поле, потом значение, условие
// садится чипом в строку. До этого фильтры были фиксированным рядом селектов,
// которые занимали место даже когда не нужны, и добавить поле было нельзя.

import { ChevronLeft, Check, Filter, Plus, X } from 'lucide-react';
import { useState } from 'react';
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
  /** Как в Asana: одно поле можно фильтровать сразу по нескольким значениям. */
  multi?: boolean;
};

/** Значения мультиполя хранятся строкой «a,b,c» — так же уходят на сервер. */
export function splitValues(value: string, empty: string): string[] {
  return value === empty ? [] : value.split(',').filter(Boolean);
}

export type FilterValues = Record<FilterFieldKey, string>;

export type FilterPreset = {
  id: string;
  label: string;
  values: Partial<FilterValues>;
};

function optionLabel(field: FilterField, value: string): string {
  if (!field.multi) return field.options.find((option) => option.value === value)?.label || value;
  const selected = splitValues(value, field.empty);
  const first = field.options.find((option) => option.value === selected[0])?.label || selected[0];
  return selected.length > 1 ? `${first} +${selected.length - 1}` : first;
}

function toggleValue(field: FilterField, current: string, option: string): string {
  const selected = splitValues(current, field.empty);
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
  // На телефоне вложенное подменю Radix уезжало за правый край (left 370 при
  // ширине экрана 390), поэтому там вместо него drill-down: панель показывает
  // либо список полей, либо значения выбранного поля.
  const [drill, setDrill] = useState<FilterFieldKey | null>(null);
  const drillField = stacked ? fields.find((field) => field.key === drill) : undefined;

  const active = fields.filter((field) => values[field.key] !== field.empty);
  // В меню держим все поля, а не только незанятые: иначе после первой галочки
  // поле уходило из списка, подменю размонтировалось и отметить второе
  // значение было нельзя.
  const available = fields;

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
            <DropdownMenuContent
              align="start"
              collisionPadding={8}
              className={`max-h-80 overflow-y-auto ${stacked ? 'w-[calc(100vw-2rem)]' : ''}`}
            >
              <DropdownMenuLabel>{field.label}</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {field.options.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={
                    field.multi
                      ? splitValues(values[field.key], field.empty).includes(option.value)
                      : values[field.key] === option.value
                  }
                  onSelect={(event) => {
                    // Мультивыбор: меню остаётся открытым, чтобы отметить
                    // несколько значений подряд.
                    if (field.multi) event.preventDefault();
                  }}
                  onCheckedChange={() =>
                    onChange(
                      field.key,
                      field.multi
                        ? toggleValue(field, values[field.key], option.value)
                        : option.value,
                    )
                  }
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

      <DropdownMenu onOpenChange={(open) => !open && setDrill(null)}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={`${toolbarControl} ${stacked ? 'w-full justify-center' : ''}`}
          >
            <Plus size={14} />
            Фильтр
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          collisionPadding={8}
          className={
            stacked ? 'max-h-80 w-[calc(100vw-2rem)] overflow-y-auto' : 'min-w-48'
          }
        >
          {drillField ? (
            <>
              <DropdownMenuItem
                onSelect={(event) => {
                  event.preventDefault();
                  setDrill(null);
                }}
              >
                <ChevronLeft className="size-4" />
                {drillField.label}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              {drillField.options.map((option) => (
                <DropdownMenuCheckboxItem
                  key={option.value}
                  checked={
                    drillField.multi
                      ? splitValues(values[drillField.key], drillField.empty).includes(option.value)
                      : values[drillField.key] === option.value
                  }
                  onSelect={(event) => {
                    if (drillField.multi) event.preventDefault();
                  }}
                  onCheckedChange={() =>
                    onChange(
                      drillField.key,
                      drillField.multi
                        ? toggleValue(drillField, values[drillField.key], option.value)
                        : option.value,
                    )
                  }
                >
                  {option.label}
                  {option.hint ? (
                    <span className="ml-1 text-muted-foreground">{option.hint}</span>
                  ) : null}
                </DropdownMenuCheckboxItem>
              ))}
            </>
          ) : (
            <>
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
                ) : stacked ? (
                  <DropdownMenuItem
                    key={field.key}
                    onSelect={(event) => {
                      event.preventDefault();
                      setDrill(field.key);
                    }}
                  >
                    {field.label}
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuSub key={field.key}>
                    <DropdownMenuSubTrigger>{field.label}</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
                      {field.options.map((option) =>
                        field.multi ? (
                          <DropdownMenuCheckboxItem
                            key={option.value}
                            checked={splitValues(values[field.key], field.empty).includes(
                              option.value,
                            )}
                            onSelect={(event) => event.preventDefault()}
                            onCheckedChange={() =>
                              onChange(
                                field.key,
                                toggleValue(field, values[field.key], option.value),
                              )
                            }
                          >
                            {option.label}
                            {option.hint ? (
                              <span className="ml-1 text-muted-foreground">{option.hint}</span>
                            ) : null}
                          </DropdownMenuCheckboxItem>
                        ) : (
                          <DropdownMenuItem
                            key={option.value}
                            onClick={() => onChange(field.key, option.value)}
                          >
                            {option.label}
                            {option.hint ? (
                              <span className="ml-1 text-muted-foreground">{option.hint}</span>
                            ) : null}
                          </DropdownMenuItem>
                        ),
                      )}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                ),
              )}
            </>
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
