'use client';

import {
  Bell,
  CalendarDays,
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

// Строка навигации остаётся кодом приложения: это продуктовый паттерн, а не
// примитив набора. Вид как у NavItem из @monos/ui.
export const NAV_ITEMS = [
  { href: '/', icon: LayoutDashboard, label: 'Главная' },
  { href: '/projects-summary', icon: TableProperties, label: 'Сводка проектов' },
  { href: '/search', icon: Search, label: 'Поиск' },
  { href: '/all-tasks', icon: ListChecks, label: 'Все задачи' },
  { href: '/my-tasks', icon: UserCheck, label: 'Мои задачи' },
  { href: '/team-workload', icon: CalendarDays, label: 'Нагрузка команды' },
  { href: '/messenger', icon: MessagesSquare, label: 'Сообщения' },
  { href: '/notifications', icon: Bell, label: 'Уведомления' },
] as const;

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

  function onDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = order.indexOf(String(active.id));
    const to = order.indexOf(String(over.id));
    if (from >= 0 && to >= 0) onReorder(arrayMove(order, from, to));
  }

  const items = order
    .map((href) => NAV_ITEMS.find((item) => item.href === href))
    .filter((item): item is (typeof NAV_ITEMS)[number] => Boolean(item));

  return (
    <DndContext
      id="sidebar-nav"
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictToVerticalAxis]}
      onDragEnd={onDragEnd}
      accessibility={{
        screenReaderInstructions: {
          draggable:
            'Чтобы переставить пункт меню, нажмите пробел, выберите место стрелками и нажмите пробел ещё раз. Escape отменяет.',
        },
        announcements: {
          onDragStart: ({ active }) => `Пункт «${ANNOUNCE_LABEL(active.id)}» поднят.`,
          onDragOver: ({ active, over }) =>
            over ? `«${ANNOUNCE_LABEL(active.id)}» над «${ANNOUNCE_LABEL(over.id)}».` : undefined,
          onDragEnd: ({ active, over }) =>
            over
              ? `«${ANNOUNCE_LABEL(active.id)}» перенесён на место «${ANNOUNCE_LABEL(over.id)}».`
              : `«${ANNOUNCE_LABEL(active.id)}» оставлен на месте.`,
          onDragCancel: ({ active }) => `Перенос «${ANNOUNCE_LABEL(active.id)}» отменён.`,
        },
      }}
    >
      <SortableContext items={order} strategy={verticalListSortingStrategy}>
        <div className="space-y-0.5">
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
    </DndContext>
  );
}
