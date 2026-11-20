'use client';

import {
  Activity,
  Bell,
  Bug,
  CalendarClock,
  Clock,
  FileText,
  Gauge,
  Hourglass,
  CalendarSync,
  TimerOff,
  LayoutDashboard,
  Scale,
  CalendarDays,
  ClipboardList,
  ChevronRight,
  ChartNoAxesColumn,
  PanelsTopLeft,
  ListChecks,
  MessagesSquare,
  Search,
  TableProperties,
  UserCheck,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
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
import { Skeleton } from '@/components/monos/Skeleton';
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
    href: '/project-status',
    icon: ClipboardList,
    section: 'reports',
    get label() {
      return t('Статусы проектов');
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
  {
    href: '/dashboards',
    icon: PanelsTopLeft,
    section: 'control',
    get label() {
      return t('Дашборды');
    },
  },
  {
    href: '/reports/plan-fact',
    icon: Scale,
    section: 'control',
    get label() {
      return t('План и факт');
    },
  },
  {
    href: '/reports/deadlines',
    icon: CalendarClock,
    section: 'control',
    get label() {
      return t('Сроки');
    },
  },
  {
    href: '/reports/throughput',
    icon: Activity,
    section: 'control',
    get label() {
      return t('Поток задач');
    },
  },
  {
    href: '/reports/defects',
    icon: Bug,
    section: 'control',
    get label() {
      return t('Брак');
    },
  },
  {
    href: '/reports/timesheets',
    icon: Clock,
    section: 'control',
    get label() {
      return t('Списание часов');
    },
  },
  {
    href: '/reports/stale',
    icon: Hourglass,
    section: 'control',
    get label() {
      return t('Зависшие задачи');
    },
  },
  {
    href: '/reports/shifts',
    icon: CalendarSync,
    section: 'control',
    get label() {
      return t('Переносы сроков');
    },
  },
  {
    href: '/reports/untracked',
    icon: TimerOff,
    section: 'control',
    get label() {
      return t('Закрыты без списаний');
    },
  },
  {
    href: '/reports/client',
    icon: FileText,
    section: 'control',
    get label() {
      return t('Отчёт клиенту');
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
  {
    key: 'control',
    icon: Gauge,
    get label() {
      return t('Контроль');
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

// Постоянное меню с 1024px: только тогда справа от него есть место для выплывающей группы.
export function useWideScreen() {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const apply = () => setWide(query.matches);
    apply();
    query.addEventListener('change', apply);
    return () => query.removeEventListener('change', apply);
  }, []);
  return wide;
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
  badge?: number | null;
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
      {badge === null ? (
        // Счётчик ещё не отвечал: пульс вместо пустоты, иначе кажется, что
        // непрочитанных нет, а потом число «вдруг» появляется.
        <Skeleton width="1.75rem" height="1.1rem" rounded="full" />
      ) : badge !== undefined && badge > 0 ? (
        <Badge tone="neutral">{badge}</Badge>
      ) : null}
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
  badges?: Record<string, number | null>;
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

  // На широком экране группа выплывает вправо от меню, а не раскрывается в списке: иначе
  // она сдвигает проекты вниз. fixed, потому что nav прокручивается и обрезала бы абсолютную
  // панель; координаты берём от кнопки и края самого меню.
  const wide = useWideScreen();
  const [flyout, setFlyout] = useState<{ key: string; top: number; left: number } | null>(null);
  const flyoutRef = useRef<HTMLDivElement>(null);
  const buttons = useRef<Record<string, HTMLButtonElement | null>>({});
  useEffect(() => {
    if (!flyout) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !flyoutRef.current?.contains(target) &&
        !Object.values(buttons.current).some((button) => button?.contains(target))
      )
        setFlyout(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      buttons.current[flyout.key]?.focus();
      setFlyout(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [flyout]);
  const toggleFlyout = (key: string) => {
    const button = buttons.current[key];
    if (!button || flyout?.key === key) return setFlyout(null);
    setFlyout({
      key,
      top: button.getBoundingClientRect().top,
      left: (button.closest('aside') ?? button).getBoundingClientRect().right,
    });
  };
  const navigate = () => {
    setFlyout(null);
    onNavigate();
  };

  const list = (section: NavSection, id?: string, flat = false) => {
    const items = itemsOf(section);
    return (
      <SortableContext
        items={items.map((item) => item.href)}
        strategy={verticalListSortingStrategy}
      >
        <div id={id} className={`space-y-0.5 ${section === 'main' || flat ? '' : 'pl-3'}`}>
          {items.map((item) => (
            <SortableNavLink
              key={item.href}
              item={item}
              pathname={pathname}
              onNavigate={flat ? navigate : onNavigate}
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
          const expanded = wide ? flyout?.key === group.key : open.includes(group.key);
          const Icon = group.icon;
          const hidden = itemsOf(group.key).reduce(
            (sum, item) => sum + (badges[item.href] || 0),
            0,
          );
          return (
            <div key={group.key}>
              <button
                type="button"
                ref={(node) => {
                  buttons.current[group.key] = node;
                }}
                aria-expanded={expanded}
                aria-controls={`nav-${group.key}`}
                onClick={() => (wide ? toggleFlyout(group.key) : toggle(group.key))}
                className={`flex min-h-9 w-full items-center gap-2.5 rounded-ui px-2.5 text-sm transition-colors duration-fast hover:bg-surface hover:text-ink max-sm:min-h-11 ${
                  wide && (expanded || activeSection === group.key)
                    ? 'bg-surface text-ink'
                    : 'text-ink-soft'
                }`}
              >
                <Icon size={16} strokeWidth={1.7} />
                <span className="min-w-0 flex-1 truncate text-left">{group.label}</span>
                {!expanded && hidden > 0 ? <Badge tone="neutral">{hidden}</Badge> : null}
                <ChevronRight
                  size={14}
                  strokeWidth={1.7}
                  aria-hidden
                  className={`transition-transform duration-fast ${expanded && !wide ? 'rotate-90' : ''}`}
                />
              </button>
              {/* lg:hidden: до гидрации на широком экране раскрытая группа не мелькает в списке. */}
              {expanded && !wide && (
                <div className="lg:hidden">{list(group.key, `nav-${group.key}`)}</div>
              )}
              {expanded && wide && flyout && (
                <div
                  ref={flyoutRef}
                  style={{
                    top: flyout.top,
                    left: flyout.left + 8,
                    maxHeight: `calc(100dvh - ${flyout.top}px - 8px)`,
                  }}
                  className="fixed z-menu w-60 overflow-y-auto rounded-ui border border-line bg-canvas p-2 shadow-overlay"
                >
                  {list(group.key, `nav-${group.key}`, true)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </DndContext>
  );
}
