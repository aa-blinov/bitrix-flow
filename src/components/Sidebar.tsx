'use client';
import { useKanbanStore } from '@/store/kanban';
import { NO_PROJECT_ID, NO_PROJECT_NAME } from '@/lib/no-project';
import { Menu, LogOut, ChevronDown, Plus, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Button } from '@/components/monos/Button';
import { Checkbox } from '@/components/monos/Checkbox';
import { Drawer } from '@/components/monos/Drawer';
import { IconButton } from '@/components/monos/IconButton';
import { Modal } from '@/components/monos/Modal';
import { Notice } from '@/components/monos/Notice';
import { SelectField } from '@/components/monos/SelectField';
import { Separator } from '@/components/monos/Separator';
import { TextArea } from '@/components/monos/TextArea';
import { TextField } from '@/components/monos/TextField';
import Notifications from '@/components/Notifications';
import LanguageSwitcher from '@/components/LanguageSwitcher';
import ThemeSwitcher from '@/components/ThemeSwitcher';
import { getProjectInitials, usableAvatar } from '@/lib/utils';
import LoadingState from '@/components/LoadingState';
import SortableNav, { useNavOrder } from '@/components/SortableNav';
import { useChatAlerts } from '@/components/messenger/useChatAlerts';
import { t } from '@/lib/i18n';

export default function Sidebar() {
  // Селекторы, а не весь стор: иначе Sidebar ре-рендерится на любой set()
  // (загрузка задач, стадий, SSE) и меню моргает во время первой загрузки.
  const projects = useKanbanStore((s) => s.projects);
  const currentUser = useKanbanStore((s) => s.currentUser);
  // CDN Битрикса иногда не отдаёт фото — тогда вместо битой картинки инициалы.
  const [failedPhoto, setFailedPhoto] = useState('');
  const photo = usableAvatar(currentUser.photo);
  const isLoading = useKanbanStore((s) => s.isLoading);
  const loadError = useKanbanStore((s) => s.error);
  const loadProjects = useKanbanStore((s) => s.loadProjects);
  const createProject = useKanbanStore((s) => s.createProject);

  const [mobileOpen, setMobileOpen] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [projectName, setProjectName] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [projectKeywords, setProjectKeywords] = useState('');
  const [projectStartDate, setProjectStartDate] = useState('');
  const [projectFinishDate, setProjectFinishDate] = useState('');
  const [projectVisible, setProjectVisible] = useState(true);
  const [projectOpened, setProjectOpened] = useState(false);
  const [invitePermissions, setInvitePermissions] = useState<'A' | 'E' | 'K'>('K');
  const [createError, setCreateError] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [creating, setCreating] = useState(false);

  // Раньше эффект перезапускал загрузку сразу после каждой ошибки: пока сервер
  // перезапускался, это был плотный цикл запросов, а в панели висело «Нет
  // проектов». Теперь после ошибки — повтор через 3с и честное сообщение.
  const projectsFailed = Boolean(loadError) && !projects.length;
  useEffect(() => {
    if (!projects.length && !isLoading && !loadError) void loadProjects();
  }, [isLoading, loadError, loadProjects, projects.length]);
  useEffect(() => {
    if (!projectsFailed) return;
    const timer = window.setTimeout(() => void loadProjects(), 3000);
    return () => window.clearTimeout(timer);
  }, [projectsFailed, loadError, loadProjects]);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const closeMobile = () => setMobileOpen(false);
  const pathname = usePathname();
  const router = useRouter();
  const [navOrder, setNavOrder] = useNavOrder();
  const chatUnread = useChatAlerts(pathname);

  // Недавно открытые — сверху: пятьдесят один проект по алфавиту означает, что
  // свои три-четыре приходится каждый раз искать заново.
  const [recentIds, setRecentIds] = useState<string[]>([]);
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('bitrix-flow-recent-projects') || '[]');
      if (Array.isArray(saved)) setRecentIds(saved.filter((id) => typeof id === 'string'));
    } catch {}
  }, []);
  useEffect(() => {
    const match = /^\/projects\/([^/?#]+)/.exec(pathname || '');
    if (!match) return;
    setRecentIds((current) => {
      const next = [match[1], ...current.filter((id) => id !== match[1])].slice(0, 4);
      try {
        localStorage.setItem('bitrix-flow-recent-projects', JSON.stringify(next));
      } catch {}
      return next;
    });
  }, [pathname]);

  const sortedProjects = [...projects]
    .sort((left, right) => left.name.localeCompare(right.name, 'ru', { sensitivity: 'base' }))
    .filter((project) =>
      project.name.toLocaleLowerCase('ru').includes(projectQuery.toLocaleLowerCase('ru')),
    );
  const activeProjects = sortedProjects.filter((project) => !project.isArchived);
  // Недавние показываем отдельным блоком и только когда не идёт поиск —
  // в результатах поиска порядок должен быть предсказуемым.
  const recentProjects = projectQuery
    ? []
    : recentIds
        .map((id) => activeProjects.find((project) => project.id === id))
        .filter((project): project is (typeof activeProjects)[number] => Boolean(project));
  const archivedProjects = sortedProjects.filter((project) => project.isArchived);

  function getInitials(name: string): string {
    return name
      .split(' ')
      .map((n) => n[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
  }

  async function createNewProject() {
    if (!projectName.trim()) return;
    if (projectStartDate && projectFinishDate && projectStartDate > projectFinishDate) {
      setCreateError(t('Дата окончания не может быть раньше даты начала.'));
      return;
    }
    setCreating(true);
    setCreateError('');
    try {
      const id = await createProject({
        name: projectName.trim(),
        description: projectDescription.trim(),
        keywords: projectKeywords.trim(),
        startDate: projectStartDate || undefined,
        finishDate: projectFinishDate || undefined,
        visible: projectVisible,
        opened: projectOpened,
        initiatePerms: invitePermissions,
      });
      setProjectName('');
      setProjectDescription('');
      setProjectKeywords('');
      setProjectStartDate('');
      setProjectFinishDate('');
      setProjectVisible(true);
      setProjectOpened(false);
      setInvitePermissions('K');
      setCreateOpen(false);
      setMobileOpen(false);
      router.push(`/projects/${id}`);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : t('Не удалось создать проект.'));
    } finally {
      setCreating(false);
    }
  }

  // Раздел учётных записей виден только администраторам; сервер всё равно проверяет роль.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    void fetch('/api/auth/me')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setIsAdmin(data?.role === 'admin'))
      .catch(() => {});
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    try {
      localStorage.removeItem('bitrix-kanban');
      localStorage.removeItem('bitrix_member_id');
      sessionStorage.clear();
    } catch {}
    window.location.assign('/login');
  }

  const projectLinkClass = (active: boolean) =>
    `flex min-h-9 items-center gap-2.5 rounded-ui px-2.5 text-sm transition-colors duration-fast max-sm:min-h-11 ${
      active ? 'bg-surface font-bold text-ink' : 'text-ink-soft hover:bg-surface hover:text-ink'
    }`;

  const SidebarContent = () => (
    // ponytail: w-full + min-w-0 — без этого flex-child растягивается по
    // самому широкому контенту (поиск проектов) и вылезает за w-64 родителя.
    <div className="flex h-full w-full min-w-0 flex-col bg-canvas">
      {/* Logo */}
      <div className="flex h-16 items-center border-b border-line px-4">
        <span className="text-lg font-bold tracking-tight text-ink">BitrixFlow</span>
      </div>

      {/* Navigation */}
      <nav className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto overscroll-contain px-3 py-4">
        <SortableNav
          order={navOrder}
          onReorder={setNavOrder}
          pathname={pathname}
          onNavigate={closeMobile}
          badges={{ '/messenger': chatUnread }}
        />

        {/* Projects — растягивается, чтобы заполнить свободное место в сайдбаре */}
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="mb-2 flex items-center justify-between px-2.5">
            <p className="text-whisper font-bold uppercase tracking-widest text-ink-faint">
              {t('Проекты (')}
              {(isLoading || projectsFailed) && !projects.length ? '…' : projects.length})
            </p>
            <IconButton
              label={t('Создать проект')}
              variant="ghost"
              size="sm"
              tooltipText=""
              onClick={() => setCreateOpen(true)}
            >
              <Plus size={16} strokeWidth={1.7} />
            </IconButton>
          </div>
          <TextField
            variant="boxed"
            size="sm"
            value={projectQuery}
            onChange={(event) => setProjectQuery(event.target.value)}
            placeholder={t('Найти проект…')}
            aria-label={t('Поиск по проектам')}
            className="mb-2"
          />
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto overscroll-contain pr-1">
            {isLoading ? (
              <LoadingState className="min-h-24 bg-transparent" />
            ) : sortedProjects.length > 0 ? (
              <>
                {/* Задачи вне проектов иначе не увидеть: в Bitrix у них нет
                    ни группы, ни страницы. */}
                {!projectQuery ? (
                  <Link
                    href={`/projects/${NO_PROJECT_ID}`}
                    prefetch={false}
                    onClick={closeMobile}
                    aria-current={pathname === `/projects/${NO_PROJECT_ID}` ? 'page' : undefined}
                    className={projectLinkClass(pathname === `/projects/${NO_PROJECT_ID}`)}
                  >
                    <span
                      className="flex size-5 shrink-0 items-center justify-center rounded-ui bg-surface-2 text-[10px] font-bold text-ink-soft"
                      aria-hidden="true"
                    >
                      —
                    </span>
                    <span className="min-w-0 flex-1 truncate">{t(NO_PROJECT_NAME)}</span>
                  </Link>
                ) : null}
                {recentProjects.length > 1 ? (
                  <>
                    <p className="px-2.5 pt-1 pb-0.5 text-whisper font-bold uppercase tracking-widest text-ink-faint">
                      {t('Недавние')}
                    </p>
                    {recentProjects.map((project) => {
                      const active = pathname === `/projects/${project.id}`;
                      return (
                        <Link
                          key={`recent-${project.id}`}
                          href={`/projects/${project.id}`}
                          prefetch={false}
                          onClick={closeMobile}
                          aria-current={active ? 'page' : undefined}
                          className={projectLinkClass(active)}
                        >
                          <span
                            className="flex size-5 shrink-0 items-center justify-center rounded-ui bg-surface-2 text-[10px] font-bold text-ink-soft"
                            aria-hidden="true"
                          >
                            {getInitials(project.name)}
                          </span>
                          <span className="truncate" title={project.name}>
                            {project.name}
                          </span>
                        </Link>
                      );
                    })}
                    <Separator className="my-1" />
                  </>
                ) : null}
                {activeProjects.map((project) => {
                  const active = pathname === `/projects/${project.id}`;
                  return (
                    <Link
                      key={project.id}
                      href={`/projects/${project.id}`}
                      prefetch={false}
                      onClick={() => setMobileOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      className={projectLinkClass(active)}
                    >
                      <span
                        className="flex size-5 shrink-0 items-center justify-center rounded-ui bg-surface-2 text-[10px] font-bold text-ink-soft"
                        aria-hidden="true"
                      >
                        {getProjectInitials(project.name)}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{project.name}</span>
                    </Link>
                  );
                })}
                {archivedProjects.length > 0 ? (
                  <div className="mt-2 border-t border-line pt-2">
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => setArchiveOpen((open) => !open)}
                      className="w-full justify-start gap-1 text-left"
                    >
                      <ChevronDown
                        className={`size-3 transition-transform ${
                          archiveOpen || projectQuery ? 'rotate-180' : ''
                        }`}
                        strokeWidth={1.7}
                      />
                      {t('Архив (')}
                      {archivedProjects.length})
                    </Button>
                    {archiveOpen || projectQuery
                      ? archivedProjects.map((project) => {
                          const active = pathname === `/projects/${project.id}`;
                          return (
                            <Link
                              key={project.id}
                              href={`/projects/${project.id}`}
                              prefetch={false}
                              onClick={() => setMobileOpen(false)}
                              aria-current={active ? 'page' : undefined}
                              className={projectLinkClass(active)}
                            >
                              <span
                                className="flex size-5 shrink-0 items-center justify-center rounded-ui bg-surface-2 text-[10px] font-bold text-ink-soft"
                                aria-hidden="true"
                              >
                                {getProjectInitials(project.name)}
                              </span>
                              <span className="min-w-0 flex-1 truncate">{project.name}</span>
                            </Link>
                          );
                        })
                      : null}
                  </div>
                ) : null}
              </>
            ) : projectsFailed ? (
              <div
                role="alert"
                className="flex items-center justify-between gap-2 px-2.5 py-1.5 text-xs"
              >
                <span className="text-danger-text">{t('Не удалось загрузить проекты')}</span>
                <Button variant="quiet" size="sm" onClick={() => void loadProjects()}>
                  {t('Повторить')}
                </Button>
              </div>
            ) : (
              <div className="px-2.5 py-1.5 text-xs text-ink-faint">{t('Нет проектов')}</div>
            )}
          </div>
        </div>
      </nav>

      {/* User — двухстрочный бар: имя сверху, действия снизу */}
      <div className="p-3">
        <Separator className="mb-3" />
        <div className="mb-2 flex items-center gap-2.5 px-1">
          {photo && failedPhoto !== photo ? (
            <img
              src={photo}
              alt=""
              className="size-8 shrink-0 rounded-full object-cover"
              onError={() => setFailedPhoto(photo)}
            />
          ) : (
            <div className="flex size-8 items-center justify-center rounded-full bg-surface-2 text-xs font-bold text-ink">
              {currentUser.id ? getInitials(currentUser.name) : '…'}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-ink">
              {/* «Не определён» пугал, пока профиль просто грузился. */}
              {currentUser.id ? currentUser.name : '…'}
            </p>
          </div>
        </div>
        <div className="flex items-center justify-between gap-1">
          <Notifications />
          <div className="flex items-center gap-1">
            <IconButton
              label={t('Выйти')}
              variant="ghost"
              size="sm"
              tooltipText=""
              onClick={() => void logout()}
            >
              <LogOut size={16} strokeWidth={1.7} />
            </IconButton>
          </div>
        </div>
        {isAdmin && (
          <Link
            href="/accounts"
            className="mt-2 flex min-h-9 items-center gap-2 rounded-ui px-2.5 text-sm text-ink-soft hover:bg-surface-2 hover:text-ink"
          >
            <Users size={16} strokeWidth={1.7} />
            {t('Учётные записи')}
          </Link>
        )}
        <div className="mt-2 space-y-2">
          <ThemeSwitcher />
          <LanguageSwitcher />
        </div>
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile navigation opens separately from page headers, so it never
          competes with a close button or project actions. */}
      {/* Обёртка fixed, а не сама кнопка: подсказка кнопки это строчный span, и в потоке
          страницы он занимал пустую строку в 24 px над всем содержимым. */}
      <div className="fixed right-4 bottom-4 z-menu lg:hidden">
        <IconButton
          label={t('Открыть меню')}
          variant="outline"
          size="lg"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          <Menu size={22} strokeWidth={1.7} />
        </IconButton>
      </div>

      <Drawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        side="left"
        title={t('Меню')}
        className="w-[86vw] max-w-sm p-0 lg:hidden"
      >
        <SidebarContent />
      </Drawer>

      {/* Desktop sidebar */}
      {/* Постоянное меню — с 1024px: на планшете в портрете 256px съедали доску. */}
      {/* Выше шапки страниц (z-menu): панель уведомлений выходит за край сайдбара и иначе пряталась под ними. */}
      <aside className="fixed inset-y-0 left-0 z-[45] hidden h-screen w-64 border-r border-line bg-canvas lg:flex">
        {SidebarContent()}
      </aside>

      <Modal
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
        title={t('Новый проект')}
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)} disabled={creating}>
              {t('Отмена')}
            </Button>
            <Button
              onClick={() => void createNewProject()}
              disabled={!projectName.trim() || creating}
              loading={creating}
            >
              {t('Создать проект')}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <TextField
            label={t('Название проекта')}
            variant="boxed"
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder={t('Например, Запуск нового продукта')}
            autoFocus
          />
          <TextArea
            label={t('Описание')}
            variant="boxed"
            value={projectDescription}
            onChange={(event) => setProjectDescription(event.target.value)}
            placeholder={t('Цель, контекст и ожидаемый результат')}
            rows={3}
          />
          <TextField
            label={t('Ключевые слова')}
            variant="boxed"
            value={projectKeywords}
            onChange={(event) => setProjectKeywords(event.target.value)}
            placeholder={t('Например, запуск, mobile, клиент')}
            hint={t('Разделяйте слова запятыми.')}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField
              label={t('Дата начала')}
              variant="boxed"
              type="date"
              value={projectStartDate}
              onChange={(event) => setProjectStartDate(event.target.value)}
            />
            <TextField
              label={t('Дата окончания')}
              variant="boxed"
              type="date"
              value={projectFinishDate}
              min={projectStartDate || undefined}
              onChange={(event) => setProjectFinishDate(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-3 rounded-ui border border-line p-3">
            <Checkbox
              checked={projectVisible}
              onChange={(event) => setProjectVisible(event.target.checked)}
            >
              {t('Показывать проект в общем списке')}
            </Checkbox>
            <Checkbox
              checked={projectOpened}
              onChange={(event) => setProjectOpened(event.target.checked)}
            >
              {t('Разрешить свободное вступление')}
            </Checkbox>
            <SelectField
              label={t('Кто может приглашать участников')}
              variant="boxed"
              value={invitePermissions}
              onChange={(event) => setInvitePermissions(event.target.value as 'A' | 'E' | 'K')}
              options={[
                { value: 'A', label: t('Только владелец') },
                { value: 'E', label: t('Владелец и модераторы') },
                { value: 'K', label: t('Все участники') },
              ]}
            />
          </div>
          {createError ? <Notice tone="danger">{createError}</Notice> : null}
        </div>
      </Modal>
    </>
  );
}
