'use client';

// Горячие клавиши уровня приложения. В инструменте, где сидят весь день,
// «/» и «n» экономят десятки кликов; всё остальное остаётся мышью.
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/toast';

/** Пока пользователь печатает, клавиши приложению не принадлежат. */
function isTyping(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  if (!element) return false;
  const tag = element.tagName?.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    element.isContentEditable === true ||
    Boolean(element.closest?.('[role="dialog"]'))
  );
}

export default function KeyboardShortcuts() {
  const router = useRouter();
  const toast = useToast();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey || isTyping(event.target)) return;

      if (event.key === '/') {
        event.preventDefault();
        // Сначала поиск по задачам на самой странице, и только потом — поиск
        // проектов в панели: иначе «/» уводил фокус не туда.
        const field =
          document.querySelector<HTMLInputElement>('input[placeholder^="Поиск задач"]') ||
          document.querySelector<HTMLInputElement>('input[type="search"]') ||
          document.querySelector<HTMLInputElement>('input[placeholder^="Поиск"]');
        if (field) field.focus();
        else router.push('/search');
        return;
      }
      if (event.key === 'n') {
        const create = [...document.querySelectorAll<HTMLElement>('button')].find((button) =>
          /добавить задачу|новая задача/i.test(button.textContent || ''),
        );
        if (create) {
          event.preventDefault();
          create.click();
        }
        return;
      }
      if (event.key === '?') {
        event.preventDefault();
        toast({
          title: 'Горячие клавиши',
          description: '/ — поиск, n — новая задача, g затем h/t/m — переходы, ? — эта подсказка',
          durationMs: 7000,
        });
        return;
      }
      // Переходы в духе «g, потом буква»: g h — главная, g t — все задачи,
      // g m — мои, g w — нагрузка.
      if (event.key === 'g') {
        const onNext = (next: KeyboardEvent) => {
          const routes: Record<string, string> = {
            h: '/',
            t: '/all-tasks',
            m: '/my-tasks',
            w: '/team-workload',
            s: '/search',
          };
          const route = routes[next.key];
          if (route && !isTyping(next.target)) {
            next.preventDefault();
            router.push(route);
          }
          window.removeEventListener('keydown', onNext, true);
        };
        window.addEventListener('keydown', onNext, true);
        window.setTimeout(() => window.removeEventListener('keydown', onNext, true), 1200);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [router, toast]);

  return null;
}
