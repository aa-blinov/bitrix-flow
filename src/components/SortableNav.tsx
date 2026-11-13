'use client';

import {
  Bell,
  CalendarDays,
  ChevronRight,
  ChartNoAxesColumn,
  LayoutDashboard,
  ListChecks,
  MessagesSquare,
  Search,
  TableProperties,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/monos/Badge';
import { t } from '@/lib/i18n';

// Строка навигации остаётся кодом приложения: это продуктовый паттерн, а не
// примитив набора. Вид как у NavItem из @monos/ui.
export const NAV_ITEMS = [
  {
    href: '/',
    icon: LayoutDashboard,
    section: 'main',
    get label() {
      return t('Главная');
    },
  },
  {
    href: '/search',
    icon: Search,
    section: 'main',
    get label() {
      return t('Поиск');
    },
  },
  {
    href: '/messenger',
    icon: MessagesSquare,
    section: 'main',
    get label() {
      return t('Сообщения');
    },
  },
  {
    href: '/notifications',
    icon: Bell,
    section: 'main',
    get label() {
      return t('Уведомления');
    },
  },
  {
    href: '/my-tasks',
    icon: UserCheck,
    section: 'tasks',
    get label() {
      return t('Мои задачи');
    },
  },
  {
    href: '/all-tasks',
    icon: ListChecks,
    section: 'tasks',
    get label() {
      return t('Все задачи');
    },
  },
  {
    href: '/projects-summary',
    icon: TableProperties,
    section: 'reports',
    get label() {
      return t('Сводка проектов');
    },
  },
  {
    href: '/team-workload',
    icon: CalendarDays,
    section: 'reports',
    get label() {
      return t('Нагрузка команды');
    },
  },
  {
    href: '/analytics',
    icon: ChartNoAxesColumn,
    section: 'reports',
    get label() {
      return t('Аналитика часов');
    },
  },
] as const;

type NavSection = (typeof NAV_ITEMS)[number]['section'];

// Каждодневное лежит сверху без группы, остальное свёрнуто в группы: девять пунктов подряд
// читались сплошной стеной.
const GROUPS = [
  {
    key: 'tasks',
    icon: ListChecks,
    get label() {
      return t('Задачи');
    },
  },
  {
    key: 'reports',
    icon: ChartNoAxesColumn,
    get label() {
      return t('Отчёты');
    },
  },
] as const;

const sectionOf = (href: string) => NAV_ITEMS.find((item) => item.href === href)?.section;

const DEFAULT_ORDER: string[] = NAV_ITEMS.map((item) => item.href);
const STORAGE_KEY = 'bitrix-flow-nav-order';

// Сохранённый порядок может отстать от кода: пункт, которого уже нет,
// выпадает, новый пункт встаёт в конец, а не пропадает из меню.
export function resolveNavOrder(saved: unknown): string[] {
  const known = Array.isArray(saved)
    ? saved.filter((href): href is string => DEFAULT_ORDER.includes(href as string))
    : [];
  const unique = [...new Set(known)];
  return [...unique, ...DEFAULT_ORDER.filter((href) => !unique.includes(href))];
}

// Порядок пункта меню личная настройка браузера, как и недавние проекты:
// на сервере ей негде жить, пока в приложении нет профиля пользователя.
export function useNavOrder() {
  const [order, setOrder] = useState<string[]>(DEFAULT_ORDER);
  useEffect(() => {
    try {
      setOrder(resolveNavOrder(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')));
    } catch {}
  }, []);
  const update = (next: string[]) => {
    setOrder(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {}
  };
  return [order, update] as const;
}

function SortableNavLink({
  item,
  pathname,
  onNavigate,
  badge,
}: {
  item: (typeof NAV_ITEMS)[number];
  pathname: string;
  onNavigate: () => void;
  badge?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.href,
  });
  const active = pathname === item.href;
  const Icon = item.icon;
  return (
    <Link
      ref={setNodeRef}
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      // Браузер тянет ссылку сам; нужен жест dnd-kit, а не перетаскивание адреса.
      draggable={false}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      // dnd-kit ставит role="button", а это ссылка: имя роли остаётся родным.
      role="link"
      {...listeners}
      className={`flex min-h-9 items-center gap-2.5 rounded-ui px-2.5 text-sm transition-colors duration-fast max-sm:min-h-11 ${
        isDragging ? 'relative z-10 cursor-grabbing bg-surface-2 shadow-overlay' : ''
      } ${
        active ? 'bg-surface font-bold text-ink' : 'text-ink-soft hover:bg-surface hover:text-ink'
      }`}
    >
      <Icon size={16} strokeWidth={1.7} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {badge !== undefined && badge > 0 ? <Badge tone="neutral">{badge}</Badge> : null}
    </Link>
  );
}

// Меню вертикальное: пункт не уходит вбок вслед за курсором (отдельный пакет
// модификаторов ради одной строки не нужен).
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });

const ANNOUNCE_LABEL = (id: string | number) =>
  NAV_ITEMS.find((item) => item.href === id)?.label || String(id);

export default function SortableNav({
  order,
  onReorder,
  pathname,
  onNavigate,
  badges = {},
}: {
  order: string[];
  onReorder: (order: string[]) => void;
  pathname: string;
  onNavigate: () => void;
  badges?: Record<string, number>;
}) {
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Долгое касание, чтобы прокрутка меню пальцем не превращалась в перенос.
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
    // Пробел поднимает и опускает пункт, Enter остаётся переходом по ссылке.
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space'] },
    }),
  );

  // Пункт переносится только внутри своей группы: перенос между группами ломал бы смысл
  // группировки. Порядок остальных групп в общем списке не трогаем.
  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const section = sectionOf(String(active.id));
    if (!section || sectionOf(String(over.id)) !== section) return;
    const ids = order.filter((href) => sectionOf(href) === section);
    const moved = arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id)));
    let next = 0;
    onReorder(order.map((href) => (sectionOf(href) === section ? moved[next++] : href)));
  }

  const itemsOf = (section: NavSection) =>
    order
      .map((href) => NAV_ITEMS.find((item) => item.href === href))
      .filter((item): item is (typeof NAV_ITEMS)[number] => item?.section === section);

  // Группа текущей страницы раскрыта сразу, ещё на сервере: иначе меню прыгало бы после
  // загрузки. Раскрытая группа остаётся раскрытой при переходах, пока её не свернут.
  // Между перезагрузками не храним по той же причине.
  const activeSection = sectionOf(pathname);
  const [open, setOpen] = useState<string[]>(() => (activeSection ? [activeSection] : []));
  useEffect(() => {
    if (activeSection && activeSection !== 'main')
      setOpen((current) =>
        current.includes(activeSection) ? current : [...current, activeSection],
      );
  }, [activeSection]);
  const toggle = (key: string) =>
    setOpen((current) =>
      current.includes(key) ? current.filter((item) => item !== key) : [...current, key],
    );

  const list = (section: NavSection, id?: string) => {
    const items = itemsOf(section);
    return (
      <SortableContext
        items={items.map((item) => item.href)}
        strategy={verticalListSortingStrategy}
      >
        <div id={id} className={`space-y-0.5 ${section === 'main' ? '' : 'pl-3'}`}>
          {items.map((item) => (
            <SortableNavLink
              key={item.href}
              item={item}
              pathname={pathname}
              onNavigate={onNavigate}
              badge={badges[item.href]}
            />
          ))}
        </div>
      </SortableContext>
    );
  };

  return (
    <DndContext
      id="sidebar-nav"
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable: t(
            'Чтобы переставить пункт меню, нажмите пробел, выберите место стрелками и нажмите пробел ещё раз. Escape отменяет.',
          ),
        },
        announcements: {
          onDragStart: ({ active }) => t('Пункт «{0}» поднят.', ANNOUNCE_LABEL(active.id)),
          onDragOver: ({ active, over }) =>
            over
              ? t('«{0}» над «{1}».', ANNOUNCE_LABEL(active.id), ANNOUNCE_LABEL(over.id))
              : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? t(
                  '«{0}» перенесён на место «{1}».',
                  ANNOUNCE_LABEL(active.id),
                  ANNOUNCE_LABEL(over.id),
                )
              : t('«{0}» оставлен на месте.', ANNOUNCE_LABEL(active.id)),
          onDragCancel: ({ active }) => t('Перенос «{0}» отменён.', ANNOUNCE_LABEL(active.id)),
        },
      }}
    >
      <div className="space-y-0.5">
        {list('main')}
        {GROUPS.map((group) => {
          const expanded = open.includes(group.key);
          const Icon = group.icon;
          const hidden = itemsOf(group.key).reduce(
            (sum, item) => sum + (badges[item.href] || 0),
            0,
          );
          return (
            <div key={group.key}>
              <button
                type="button"
                aria-expanded={expanded}
                aria-controls={`nav-${group.key}`}
                onClick={() => toggle(group.key)}
                className="flex min-h-9 w-full items-center gap-2.5 rounded-ui px-2.5 text-sm text-ink-soft transition-colors duration-fast hover:bg-surface hover:text-ink max-sm:min-h-11"
              >
                <Icon size={16} strokeWidth={1.7} />
                <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                {!expanded && hidden > 0 ? <Badge tone="neutral">{hidden}</Badge> : null}
                <ChevronRight
                  size={14}
                  strokeWidth={1.7}
                  aria-hidden
                  className={`transition-transform duration-fast ${expanded ? 'rotate-90' : ''}`}
                />
              </button>
              {expanded && list(group.key, `nav-${group.key}`)}
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}
