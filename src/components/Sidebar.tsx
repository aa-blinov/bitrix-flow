'use client';
import { useKanbanStore } from '@/store/kanban';
import { LayoutDashboard, Search, Menu, Inbox, LogOut, TableProperties } from 'lucide-react';
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

export default function Sidebar() {
  const {
    projects,
    setSelectedProject,
    currentUser,
    isLoading,
    tasks,
    getMyTasks,
    getOverdueTasks,
  } = useKanbanStore();

  const [mobileOpen, setMobileOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const pathname = usePathname();

  const myTasks = getMyTasks();
  const overdueTasks = getOverdueTasks();
  const completed = tasks.filter((t) => t.status === 'done').length;
  const inProgress = tasks.filter((t) => t.status === 'in_progress').length;
  const sortedProjects = [...projects]
    .sort((left, right) => left.name.localeCompare(right.name, 'ru', { sensitivity: 'base' }))
    .filter((project) =>
      project.name.toLocaleLowerCase('ru').includes(projectQuery.toLocaleLowerCase('ru')),
    );

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
          active ? 'bg-gray-100 text-gray-900 font-medium' : 'text-gray-600 hover:bg-gray-50'
        }`}
      >
        <Icon size={16} className={active ? 'text-gray-700' : 'text-gray-400'} />
        <span className="flex-1 truncate">{label}</span>
        {badge !== undefined && badge > 0 && <Badge variant="secondary">{badge}</Badge>}
      </Link>
    );
  };

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex h-16 items-center border-b px-4">
        <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <span className="text-white font-bold text-sm">B</span>
        </div>
        <span className="ml-2.5 font-semibold text-gray-900 text-sm">Bitrix24 PM</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 space-y-5 overflow-y-auto px-3 py-4">
        <div className="space-y-0.5">
          <NavItem href="/" icon={LayoutDashboard} label="Главная" />
          <NavItem href="/projects-summary" icon={TableProperties} label="Сводка проектов" />
          <NavItem href="/my-tasks" icon={Inbox} label="Мои задачи" badge={myTasks.length} />
          <NavItem href="/search" icon={Search} label="Поиск" />
        </div>

        {/* Quick stats */}
        <div>
          <h3 className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Статус
          </h3>
          <div className="space-y-0.5 rounded-lg bg-muted/50 p-1">
            <div className="flex items-center gap-2.5 px-2 py-1.5 text-sm">
              <div className="w-2 h-2 rounded-full bg-red-500" />
              <span className="flex-1 text-muted-foreground">Просрочено</span>
              <span className="text-xs text-gray-500 font-medium">{overdueTasks.length}</span>
            </div>
            <div className="flex items-center gap-2.5 px-2 py-1.5 text-sm">
              <div className="w-2 h-2 rounded-full bg-blue-500" />
              <span className="flex-1 text-muted-foreground">В работе</span>
              <span className="text-xs text-gray-500 font-medium">{inProgress}</span>
            </div>
            <div className="flex items-center gap-2.5 px-2 py-1.5 text-sm">
              <div className="w-2 h-2 rounded-full bg-green-500" />
              <span className="flex-1 text-muted-foreground">Готово</span>
              <span className="text-xs text-gray-500 font-medium">{completed}</span>
            </div>
          </div>
        </div>

        {/* Projects */}
        <div>
          <h3 className="mb-2 px-2.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Проекты ({projects.length})
          </h3>
          <Input
            value={projectQuery}
            onChange={(event) => setProjectQuery(event.target.value)}
            placeholder="Найти проект…"
            className="mb-2 h-8"
          />
          <div className="max-h-72 space-y-0.5 overflow-y-auto pr-1">
            {isLoading ? (
              <div className="px-2.5 py-1.5 text-xs text-muted-foreground">Загрузка…</div>
            ) : sortedProjects.length > 0 ? (
              sortedProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/projects/${project.id}`}
                  onClick={() => setMobileOpen(false)}
                  className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-md text-sm transition-colors ${
                    pathname === `/projects/${project.id}`
                      ? 'bg-gray-100 text-gray-900 font-medium'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                      pathname === `/projects/${project.id}` ? 'bg-blue-500' : 'bg-gray-300'
                    }`}
                  />
                  <span className="truncate">{project.name}</span>
                </Link>
              ))
            ) : (
              <div className="px-2.5 py-1.5 text-xs text-muted-foreground">Нет проектов</div>
            )}
          </div>
        </div>
      </nav>

      {/* User */}
      <div className="p-3">
        <Separator className="mb-3" />
        <div className="flex items-center gap-2.5 px-2.5 py-1.5">
          {currentUser.photo ? (
            <img src={currentUser.photo} alt="" className="size-8 rounded-full object-cover" />
          ) : (
            <div className="flex size-8 items-center justify-center rounded-full bg-gradient-to-br from-rose-500 to-pink-500 text-xs font-semibold text-white">
              {getInitials(currentUser.name)}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{currentUser.name}</p>
          </div>
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
