'use client';
import { useKanbanStore } from '@/store/kanban';
import { LayoutDashboard, ListChecks, Search, Menu, Inbox, LogOut, TableProperties, ChevronDown } from 'lucide-react';
import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { Input } from '@/components/ui/input';
import Notifications from '@/components/Notifications';
import ThemeToggle from '@/components/ThemeToggle';
import { getProjectColor, getProjectInitials } from '@/lib/utils';

export default function Sidebar() {
  const {
    projects,
    setSelectedProject,
    currentUser,
    isLoading,
    allTasks,
    isLoadingAllTasks,
    getMyTasks,
    getGlobalCounts,
  } = useKanbanStore();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [archiveOpen, setArchiveOpen] = useState(false);
  const pathname = usePathname();

  const myTasks = getMyTasks();
  const { overdue: overdueCount, in_progress: inProgress, done: completed } = getGlobalCounts();
  // Пока кэш allTasks пуст и данные в полёте — показываем «—», чтобы
  // счётчик не врал «0» пока задачи ещё грузятся из Битрикса.
  const countsPending = isLoadingAllTasks && allTasks.length === 0;
  const sortedProjects = [...projects]
    .sort((left, right) => left.name.localeCompare(right.name, 'ru', { sensitivity: 'base' }))
    .filter((project) =>
      project.name.toLocaleLowerCase('ru').includes(projectQuery.toLocaleLowerCase('ru')),
    );
  const activeProjects = sortedProjects.filter((project) => !project.isArchived);
  const archivedProjects = sortedProjects.filter((project) => project.isArchived);

  function getInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    window.location.assign('/login');
  }

  const NavItem = ({
    href,
    icon: Icon,
    label,
    badge,
  }: {
    href: string;
    icon: any;
    label: string;
    badge?: number;
  }) => {
    const active = pathname === href;
    return (
      <Link
        href={href}
        onClick={() => setMobileOpen(false)}
        className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
          active ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted'
        }`}
      >
        <Icon size={16} className={active ? 'text-foreground' : 'text-muted-foreground'} />
        <span className="flex-1 truncate">{label}</span>
        {badge !== undefined && badge > 0 && <Badge variant="secondary">{badge}</Badge>}
      </Link>
    );
  };

  const SidebarContent = () => (
    // ponytail: w-full + min-w-0 — без этого flex-child растягивается по
    // самому широкому контенту (поиск проектов) и вылезает за w-64 родителя.
    <div className="flex h-full w-full min-w-0 flex-col">
      {/* Logo */}
      <div className="flex h-16 items-center border-b px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <span className="text-white font-bold text-sm">B</span>
        </div>
        <span className="ml-2.5 text-sm font-semibold text-foreground">Bitrix24 PM</span>
      </div>

      {/* Navigation */}
      <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">
          <NavItem href="/" icon={LayoutDashboard} label="Главная" />
          <NavItem href="/projects-summary" icon={TableProperties} label="Сводка проектов" />
          <NavItem href="/my-tasks" icon={Inbox} label="Мои задачи" badge={myTasks.length} />
          <NavItem href="/all-tasks" icon={ListChecks} label="Все задачи" />
          <NavItem href="/search" icon={Search} label="Поиск" />
        </div>

        {/* Quick stats — кликабельные, ведут на /all-tasks с фильтром по статусу */}
        <div>
          <h3 className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Статус
          </h3>
          <div className="space-y-0.5 rounded-lg bg-muted/50 p-1">
            {([
              { href: '/all-tasks?status=overdue', dot: 'bg-red-500', label: 'Просрочено', value: overdueCount },
              { href: '/all-tasks?status=in_progress', dot: 'bg-blue-500', label: 'В работе', value: inProgress },
              { href: '/all-tasks?status=done', dot: 'bg-green-500', label: 'Готово', value: completed },
            ] as const).map((row) => (
              <Link
                key={row.label}
                href={row.href}
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-2.5 px-2 py-1.5 text-sm rounded transition-colors hover:bg-muted/80"
              >
                <div className={`w-2 h-2 rounded-full ${row.dot}`} />
                <span className="flex-1 text-muted-foreground">{row.label}</span>
                <span
                  className={`text-xs font-medium tabular-nums ${
                    countsPending ? 'text-muted-foreground/50' : 'text-muted-foreground'
                  }`}
                >
                  {countsPending ? '—' : row.value}
                </span>
              </Link>
            ))}
          </div>
        </div>

        {/* Projects — растягивается, чтобы заполнить свободное место в сайдбаре */}
        <div className="flex min-h-0 flex-1 flex-col">
          <h3 className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Проекты ({projects.length})
          </h3>
          <Input
            value={projectQuery}
            onChange={(event) => setProjectQuery(event.target.value)}
            placeholder="Найти проект…"
            className="mb-2 h-8"
          />
          <div className="flex-1 min-h-0 space-y-0.5 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="px-2.5 py-1.5 text-xs text-muted-foreground">Загрузка…</div>
            ) : sortedProjects.length > 0 ? (
              <>
                {activeProjects.map((project) => {
                  const active = pathname === `/projects/${project.id}`;
                  return (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      onClick={() => setMobileOpen(false)}
                      className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                        active
                          ? 'bg-muted text-foreground font-medium'
                          : 'text-muted-foreground hover:bg-muted'
                      }`}
                    >
                      <span
                        className={`flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${getProjectColor(project.name)}`}
                        aria-hidden="true"
                      >
                        {getProjectInitials(project.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    </Link>
                  );
                })}
                {archivedProjects.length > 0 && (
                  <div className="mt-2 border-t pt-2">
                    <button
                      type="button"
                      onClick={() => setArchiveOpen((open) => !open)}
                      className="flex w-full items-center gap-1 px-2.5 py-1 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown className={`size-3 transition-transform ${archiveOpen || projectQuery ? 'rotate-180' : ''}`} />
                      Архив ({archivedProjects.length})
                    </button>
                    {(archiveOpen || projectQuery) && archivedProjects.map((project) => {
                      const active = pathname === `/projects/${project.id}`;
                      return (
                        <Link
                          key={project.id}
                          href={`/projects/${project.id}`}
                          onClick={() => setMobileOpen(false)}
                          className={`flex items-center gap-2.5 px-2.5 py-1.5 text-sm transition-colors ${
                            active ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:bg-muted'
                          }`}
                        >
                          <span className={`flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold ${getProjectColor(project.name)}`}>
                            {getProjectInitials(project.name)}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{project.name}</span>
                        </Link>
                      );
                    })}
                  </div>
                )}
              </>
            ) : (
              <div className="px-2.5 py-1.5 text-xs text-muted-foreground">Нет проектов</div>
            )}
          </div>
        </div>
      </nav>

      {/* User — двухстрочный бар: имя сверху, действия снизу */}
      <div className="p-3">
        <Separator className="mb-3" />
        <div className="flex items-center gap-2.5 px-1 mb-2">
          {currentUser.photo ? (
            <img src={currentUser.photo} alt="" className="size-8 rounded-full object-cover" />
          ) : (
            <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-pink-500 text-xs font-semibold text-white">
              {getInitials(currentUser.name)}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-foreground">{currentUser.name}</p>
          </div>
        </div>
        <div className="flex items-center justify-end gap-1">
          <Notifications />
          <ThemeToggle />
          <Button variant="ghost" size="icon-sm" onClick={logout} title="Выйти" aria-label="Выйти">
            <LogOut size={16} />
          </Button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile navigation opens separately from page headers, so it never
          competes with a close button or project actions. */}
      <Button
        variant="outline"
        size="icon-lg"
        onClick={() => setMobileOpen(!mobileOpen)}
        aria-label="Открыть меню"
        className="fixed right-4 bottom-4 z-40 rounded-full bg-background shadow-lg md:hidden"
      >
        <Menu size={20} />
      </Button>

      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetContent
          side="left"
          className="w-[86vw] max-w-sm p-0 md:hidden"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <SidebarContent />
        </SheetContent>
      </Sheet>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 hidden h-screen w-64 border-r bg-background md:flex">
        <SidebarContent />
      </aside>
    </>
  );
}
