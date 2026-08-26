'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { RefreshCw, Users } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
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
    <div className="min-h-full bg-muted/20">
      <header className="sticky top-0 z-10 border-b bg-background/95 px-4 py-5 backdrop-blur sm:px-8">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Сводка по проектам</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              План, факт и операционный статус по задачам проектов
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void load(true)} disabled={isLoading}>
            <RefreshCw className={isLoading ? 'animate-spin' : ''} /> Обновить
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-8">
        <Card>
          <CardHeader className="gap-3 border-b">
            <div className="flex flex-col justify-between gap-3 lg:flex-row lg:items-start">
              <div>
                <CardTitle>Проекты</CardTitle>
                <CardDescription>
                  Полная история задач. План учитывает оценку задачи или её оценённых подзадач.
                </CardDescription>
              </div>
              <Input
                className="w-full lg:w-64"
                placeholder="Найти проект…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap items-end gap-2">
              <label className="grid gap-1 text-xs text-muted-foreground">
                <span>Считать по дате</span>
                <select
                  value={dateField}
                  onChange={(event) => setDateField(event.target.value as 'changed' | 'created')}
                  className="h-9 rounded-md border bg-background px-2 text-sm text-foreground"
                >
                  <option value="changed">изменения</option>
                  <option value="created">создания</option>
                </select>
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                <span>С</span>
                <Input
                  type="date"
                  value={fromDate}
                  onChange={(event) => setFromDate(event.target.value)}
                  className="h-9"
                />
              </label>
              <label className="grid gap-1 text-xs text-muted-foreground">
                <span>По</span>
                <Input
                  type="date"
                  value={toDate}
                  onChange={(event) => setToDate(event.target.value)}
                  className="h-9"
                />
              </label>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void load(false)}
                disabled={isLoading}
              >
                Применить
              </Button>
              {(fromDate || toDate) && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setFromDate('');
                    setToDate('');
                    setTimeout(() => void load(false), 0);
                  }}
                >
                  За всё время
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {error ? (
              <p className="p-6 text-sm text-destructive">{error}</p>
            ) : isLoading ? (
              <LoadingState label="Собираем сводку из Bitrix24…" className="min-h-72 bg-transparent" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Проект</TableHead>
                    <TableHead>План / факт</TableHead>
                    <TableHead>Прогресс</TableHead>
                    <TableHead>Задачи</TableHead>
                    <TableHead>Операционный статус</TableHead>
                    <TableHead>Активность</TableHead>
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
                        <div className="grid gap-0.5 text-sm">
                          <span>
                            <span className="text-muted-foreground">План: </span>
                            <span className="font-medium">{hours(project.plannedHours)}</span>
                          </span>
                          <span>
                            <span className="text-muted-foreground">Факт: </span>
                            <span className="font-medium">{hours(project.actualHours)}</span>
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex min-w-28 items-center gap-2">
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                            <div
                              className="h-full bg-primary"
                              style={{ width: `${project.progress}%` }}
                            />
                          </div>
                          <span className="text-xs">{project.progress}%</span>
                        </div>
                        <span className="text-xs text-muted-foreground">
                          {project.completed} из {project.leafTaskCount}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div>{project.taskCount} всего</div>
                        <div className="text-xs text-muted-foreground">
                          {project.leafTaskCount} исп. · {project.parentTaskCount} родит.
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1">
                          {project.overdue > 0 && (
                            <Badge variant="destructive">{project.overdue} просроч.</Badge>
                          )}
                          <Badge variant="secondary">{project.inProgress} в работе</Badge>
                          {project.noDeadline > 0 && (
                            <Badge variant="outline">без срока: {project.noDeadline}</Badge>
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
