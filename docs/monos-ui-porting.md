# Портирование @monos/ui в React

Приложение живёт на Next.js 16 и React 19, а набор @monos/ui написан на Svelte 4.
Svelte-компоненты в React-приложение не встают, поэтому набор переносится вручную:
исходник каждого компонента лежит в `/tmp/monos-ui-ref/src/components/*.svelte`
(клон `github:aa-blinov/monos-ui`), и порт повторяет его разметку, классы и
поведение один в один.

## Что переносится

Токены и палитры берутся из пакета как есть: `@monos/ui/styles.css` подключён в
`src/app/globals.css`. Мост в Tailwind 4 — блок `@theme inline` там же: он
перечисляет те же имена, что и пресет набора для Tailwind 3
(`@monos/ui/tailwind-preset`), но в формате Tailwind 4.

### Пространства имён в Tailwind 4

Пресет набора написан для Tailwind 3, и часть имён в v4 переехала в другие
пространства. Если взять имя из пресета как есть, класс молча не
сгенерируется: элемент останется без тени, рамки или слоя, и поломку видно
не сразу — так окно задачи однажды оказалось под липкой шапкой таблицы.

| Имя из пресета                        | Как в Tailwind 4                                           |
| ------------------------------------- | ---------------------------------------------------------- |
| `zIndex: { menu, modal, tooltip }`    | `--z-index-menu`, `--z-index-modal`, `--z-index-tooltip`   |
| `transitionDuration: { fast, base }`  | `--transition-duration-fast`, `--transition-duration-base` |
| `borderRadius: { ui }`                | `--radius-ui`                                              |
| `boxShadow: { rest, lift, overlay }`  | `--shadow-rest`, `--shadow-lift`, `--shadow-overlay`       |
| `fontSize: { whisper }`               | `--text-whisper`                                           |
| `fontFamily: { ui }`                  | `--font-ui`                                                |
| `spacing: { hair, tight, … }`         | `--spacing-hair`, `--spacing-tight`, …                     |
| `colors: { canvas, surface, ink, … }` | `--color-canvas`, `--color-surface`, …                     |

Ловит такие промахи `npm run check:utilities`: скрипт берёт классы набора из
разметки и ищет их в собранном CSS.

Компоненты живут в `src/components/monos/`. Старый слой `src/components/ui/*`
(shadcn) удаляется целиком.

## Правила порта

1. **Классы — дословно из Svelte-исходника.** Не придумывай свои: у набора
   один вид, и переписывание классов ломает галерею.
2. **Только имена из моста.** Разрешены `bg-canvas`, `bg-surface`, `bg-surface-2`,
   `text-ink`, `text-ink-soft`, `text-ink-faint`, `text-ink-muted`, `border-line`,
   `border-line-strong`, `text-accent`, `text-danger`, `text-warning`,
   `text-success`, `text-info`, `text-accent-text`, `text-danger-text`,
   `text-warning-text`, `text-success-text`, `text-info-text`, `rounded-ui`,
   `shadow-rest`, `shadow-lift`, `shadow-overlay`, `duration-fast`, `duration-base`,
   `z-menu`, `z-modal`, `z-tooltip`, `text-whisper`, `text-whisper-lg`, а также
   обычные утилиты Tailwind (`h-9`, `px-4`, `text-sm`, `gap-2`).
3. **Никаких `dark:`-вариантов.** Тёмный режим — это `[data-mode="dark"]` из
   палитры набора; роль цвета одна и та же в обеих темах.
4. **Никаких shadcn-имён** (`bg-card`, `text-muted-foreground`, `rounded-lg`,
   `border-border`, `bg-primary`): это прошлая система.
5. **Никакого сырого цвета** внутри компонентов (`#fff`, `oklch(...)`) — только
   роли.
6. **Иконки** — `lucide-react`, `strokeWidth={1.7}`, размер из шкалы набора
   (12/14/16/20/24px). Набор рисует иконки сам; `lucide-react` уже стоит в
   проекте.
7. **Доступность сохраняется**: те же `role`, `aria-*`, работа с клавиатурой и
   ловушка фокуса, что в Svelte-исходнике. Приложение проверяется axe-core, и
   нарушений быть не должно.
8. **Типы** — TypeScript, строгий режим, без `any`. Пропсы повторяют Svelte-пропсы
   в camelCase; события становятся обычными React-обработчиками, слоты —
   `children` или отдельными пропсами.
9. **Комментарии — по-русски**, и только там, где объясняется «поч», а не
   «что».
10. Файлы с интерактивом начинаются с `'use client';`.

## Уже портировано (образец)

`src/components/monos/Button.tsx`, `Card.tsx`, `TextField.tsx`, `Modal.tsx`,
`Tooltip.tsx` — по ним видно, как переносить слоты, счётчики `id` и обработчики.

## Таблица замен классов

Приложение переезжает с shadcn на роли набора. Соответствия:

| Было (shadcn)                               | Стало (monos)                            |
| ------------------------------------------- | ---------------------------------------- |
| `bg-background`                             | `bg-canvas`                              |
| `bg-card`, `bg-popover`                     | `bg-surface`                             |
| `bg-muted`, `bg-muted/40`                   | `bg-surface-2`                           |
| `text-foreground`                           | `text-ink`                               |
| `text-muted-foreground`                     | `text-ink-soft`                          |
| `text-muted-foreground` (мелкий метаданный) | `text-ink-faint`                         |
| `text-primary`                              | `text-ink`                               |
| `bg-primary`                                | `bg-ink`                                 |
| `text-primary-foreground`                   | `text-canvas`                            |
| `border-border`, `border-input`             | `border-line`                            |
| `bg-border`, `border-t`                     | `bg-line`                                |
| `ring-3 ring-ring/50`                       | удалить: кольцо фокуса задано глобально  |
| `rounded-lg`, `rounded-xl`, `rounded-md`    | `rounded-ui`                             |
| `rounded-full`                              | `rounded-full` (только круги)            |
| `shadow-sm`                                 | `shadow-rest`                            |
| `shadow-md`, `shadow-lg`, `shadow-xl`       | `shadow-overlay`                         |
| `text-destructive`                          | `text-danger-text`                       |
| `bg-destructive/10`                         | `bg-danger/10`                           |
| `text-emerald-600`                          | `text-success-text`                      |
| `text-sky-600`                              | `text-info-text`                         |
| `text-amber-600`                            | `text-warning-text`                      |
| `font-heading`                              | убрать: гарнитура одна                   |
| `text-[11px]`, `text-[10px]`                | `text-whisper`                           |
| `h-10 sm:h-8`                               | `h-11 sm:h-9` (контрол набора: 44/36/32) |

Кнопки shadcn заменяются кнопками набора, и варианты меняются по правилам
набора: залитой кнопки в нём нет.

| shadcn                  | monos                 |
| ----------------------- | --------------------- |
| `variant="default"`     | `variant="primary"`   |
| `variant="outline"`     | `variant="secondary"` |
| `variant="secondary"`   | `variant="secondary"` |
| `variant="ghost"`       | `variant="quiet"`     |
| `variant="destructive"` | `variant="danger"`    |

Поля ввода: `Input` → `TextField`, `Textarea` → `TextArea`,
`Select` → `SelectField` (нативный список), `Checkbox` → `Checkbox`,
`Dialog` → `Modal`, `Sheet` → `Drawer`, `DropdownMenu` → `Menu` или `Popover`,
`Tabs` → `Tabs`, `Table` → `Table`, `Badge` → `Badge`, `Separator` → `Separator`,
`Skeleton` → `Skeleton`, `Tooltip` → `Tooltip`, `useToast` → `useToast`
(из `@/components/monos/toast`), `useConfirm` → `useConfirm`
(из `@/components/monos/confirm-dialog`).

Шапки и подписи: `text-xs font-semibold uppercase tracking-wider text-muted-foreground`
становится `text-whisper font-bold uppercase tracking-widest text-ink-faint`.
