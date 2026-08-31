'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { useSSE } from '@/hooks/useSSE';
import LoadingState from '@/components/LoadingState';
import PageHeader from '@/components/PageHeader';

type ProjectSummary = {
  id: string;
  name: string;
  membersCount: number;
  taskCount: number;
  parentTaskCount: number;
  leafTaskCount: number;
  completed: number;
  inProgress: number;
  overdue: number;
  noDeadline: number;
  comments: number;
  plannedHours: number;
  actualHours: number;
  progress: number;
  changedAt: string | null;
};

const hours = (value: number) => `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} ч`;

export default function ProjectsSummaryPage() {
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [query, setQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [calculatedAt, setCalculatedAt] = useState('');
  const [memberId, setMemberId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [dateField, setDateField] = useState<'changed' | 'created'>('changed');
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filtersRef = useRef({ fromDate, toDate, dateField });
  filtersRef.current = { fromDate, toDate, dateField };

  const load = useCallback(async (force = false, silent = false) => {
    const memberId = localStorage.getItem('bitrix_member_id') || '';
    if (!memberId) return;
    if (!silent) setIsLoading(true);
    setError('');
    try {
      const params = new URLSearchParams();
      if (force) params.set('refresh', '1');
      if (filtersRef.current.fromDate) params.set('from', filtersRef.current.fromDate);
      if (filtersRef.current.toDate) params.set('to', filtersRef.current.toDate);
      params.set('date_field', filtersRef.current.dateField);
      const response = await fetch(`/api/projects/summary?${params}`, {
        headers: { 'X-Member-Id': memberId },
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || 'Не удалось получить сводку');
      setProjects(data.projects || []);
      setCalculatedAt(data.calculatedAt || '');
      if (data.refreshing) {
        if (refreshTimer.current) clearTimeout(refreshTimer.current);
        refreshTimer.current = setTimeout(() => {
          void load(false, true);
        }, 3000);
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось получить сводку');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    setMemberId(localStorage.getItem('bitrix_member_id') || '');
    void load();
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [load]);
  const refreshFromEvent = useCallback(() => {
    if (refreshTimer.current) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      void load(false, true);
    }, 1200);
  }, [load]);
  useSSE(memberId, refreshFromEvent);
  const shown = useMemo(
    () =>
      projects.filter((project) =>
        project.name.toLocaleLowerCase('ru').includes(query.toLocaleLowerCase('ru')),
      ),
    [projects, query],
  );

  return (
    <div className="min-h-screen bg-muted/30 pb-12">
      <PageHeader
        title="Сводка по проектам"
        description="План, факт и операционный статус по задачам проектов"
        actions={
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={isLoading}>
            <RefreshCw className={isLoading ? 'animate-spin' : ''} /> Обновить
          </Button>
        }
      />
      <main className="space-y-3 px-4 py-4 lg:px-6">
        <Card className="overflow-hidden rounded-none bg-transparent py-0 shadow-none ring-0">
          <CardHeader className="gap-3 rounded-none border-0 bg-transparent px-0 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <Input
                className="h-8 w-full rounded-md sm:w-56 lg:w-auto lg:min-w-64 lg:flex-1"
                placeholder="Найти проект…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="flex h-8 items-center gap-1.5 text-sm">
                <span className="shrink-0 text-muted-foreground">По дате:</span>
                <Select
                  value={dateField}
                  onValueChange={(value) => setDateField(value as 'changed' | 'created')}
                >
                  <SelectTrigger className="h-8 w-32 rounded-md" aria-label="Считать по дате">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="changed">изменения</SelectItem>
                    <SelectItem value="created">создания</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex h-8 items-center gap-1.5 text-sm">
                <span className="shrink-0 text-muted-foreground">Период:</span>
                <label htmlFor="summary-date-from" className="text-muted-foreground">
                  с
                </label>
                <Input
                  id="summary-date-from"
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="h-8 w-36 rounded-md"
                  aria-label="Начальная дата периода"
                />
                <label htmlFor="summary-date-to" className="text-muted-foreground">
                  по
                </label>
                <Input
                  id="summary-date-to"
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="h-8 w-36 rounded-md"
                  aria-label="Конечная дата периода"
                />
              </div>
              <Button
                variant="secondary"
                size="sm"
                className="h-8 rounded-md"
                onClick={() => void load(false)}
                disabled={isLoading}
              >
                Применить
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 rounded-md border-destructive/40 text-destructive hover:border-destructive/60 hover:bg-destructive/10 hover:text-destructive"
                disabled={!fromDate && !toDate}
                onClick={() => {
                  setFromDate('');
                  setToDate('');
                  setTimeout(() => void load(false), 0);
                }}
              >
                Сбросить
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {error ? (
              <p className="p-6 text-sm text-destructive">{error}</p>
            ) : isLoading ? (
              <LoadingState className="min-h-72 bg-transparent" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Проект</TableHead>
                    <TableHead>Часы</TableHead>
                    <TableHead>Прогресс</TableHead>
                    <TableHead>Задачи</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Изменения</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((project) => (
                    <TableRow key={project.id}>
                      <TableCell>
                        <Link
                          className="font-medium hover:underline"
                          href={`/projects/${project.id}`}
                        >
                          {project.name}
                        </Link>
                        <div className="mt-1 flex gap-2 text-xs text-muted-foreground">
                          <span className="inline-flex items-center gap-1">
                            <Users size={12} />
                            {project.membersCount}
                          </span>
                          <span>{project.comments} сообщений</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <span className="font-medium">{hours(project.plannedHours)}</span>
                          <span className="mx-1 text-muted-foreground">/</span>
                          <span className="font-medium">{hours(project.actualHours)}</span>
                        </div>
                        <div className="text-xs text-muted-foreground">план / факт</div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${project.progress}%` }}
                            />
                          </div>
                          <span className="text-xs font-medium">{project.progress}%</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {project.completed} из {project.leafTaskCount} выполнено
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="text-sm">
                          <span className="font-medium">{project.taskCount}</span>
                          <span className="ml-1 text-muted-foreground">всего</span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {project.leafTaskCount} исполнителей
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {project.overdue > 0 && (
                            <Badge asChild variant="destructive">
                              <Link href={`/projects/${project.id}?view=grid&status=overdue`}>
                                {project.overdue} просроч.
                              </Link>
                            </Badge>
                          )}
                          <Badge asChild variant="secondary">
                            <Link href={`/projects/${project.id}?view=grid&status=active`}>
                              {project.inProgress} в работе
                            </Link>
                          </Badge>
                          {project.noDeadline > 0 && (
                            <Badge asChild variant="outline">
                              <Link href={`/projects/${project.id}?view=grid&status=no_deadline`}>
                                {project.noDeadline} без срока
                              </Link>
                            </Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {project.changedAt
                          ? new Intl.DateTimeFormat('ru-RU', {
                              dateStyle: 'short',
                              timeStyle: 'short',
                            }).format(new Date(project.changedAt))
                          : 'Нет задач'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
        {calculatedAt && (
          <p className="text-xs text-muted-foreground">
            Рассчитано:{' '}
            {new Intl.DateTimeFormat('ru-RU', { timeStyle: 'medium' }).format(
              new Date(calculatedAt),
            )}
          </p>
        )}
      </main>
    </div>
  );
}
