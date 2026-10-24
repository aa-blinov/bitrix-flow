'use client';

import { ChevronLeft, ChevronRight, Download, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MediaError, useMediaLoad } from '@/components/MediaState';
import { IconButton } from '@/components/monos/IconButton';
import { Spinner } from '@/components/monos/Spinner';

export type ViewerItem = {
  id: number;
  name: string;
  kind: 'image' | 'video';
  src: string;
  downloadSrc: string;
};

// Просмотрщик фото и видео поверх страницы: листание по всем медиа диалога,
// скачивание оригинала, закрытие по Escape и клику в фон. Вместо открытия
// файла в новой вкладке, откуда в переписку приходилось возвращаться.
export default function FileViewer({
  items,
  index,
  onIndex,
  onClose,
}: {
  items: ViewerItem[];
  index: number;
  onIndex: (index: number) => void;
  onClose: () => void;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const item = items[index];
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    panel.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowLeft' && hasPrev) onIndex(index - 1);
      else if (event.key === 'ArrowRight' && hasNext) onIndex(index + 1);
      else if (event.key === 'Tab') {
        // Фокус остаётся внутри просмотрщика, пока он открыт.
        const controls = [
          ...(panel.current?.querySelectorAll<HTMLElement>('button, a[href]') || []),
        ];
        if (!controls.length) return;
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener('keydown', onKeydown);
    return () => document.removeEventListener('keydown', onKeydown);
  }, [index, hasPrev, hasNext, onIndex, onClose]);

  if (!item) return null;

  return (
    <div
      ref={panel}
      role="dialog"
      aria-modal="true"
      aria-label={`Просмотр: ${item.name}`}
      tabIndex={-1}
      className="fixed inset-0 z-modal flex flex-col bg-canvas text-ink outline-none"
    >
      <div className="flex min-h-14 items-center gap-3 border-b border-line px-4">
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{item.name}</p>
        {items.length > 1 && (
          <span className="shrink-0 text-xs text-ink-soft" aria-live="polite">
            {index + 1} из {items.length}
          </span>
        )}
        <a
          href={item.downloadSrc}
          download={item.name}
          aria-label="Скачать"
          className="inline-flex size-9 items-center justify-center rounded-ui text-ink-soft transition-colors duration-fast hover:bg-surface hover:text-ink max-sm:size-11"
        >
          <Download className="size-4" strokeWidth={1.7} />
        </a>
        <IconButton label="Закрыть" variant="ghost" tooltipText="" onClick={onClose}>
          <X className="size-4" strokeWidth={1.7} />
        </IconButton>
      </div>

      <div
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-4"
        // Клик по фону закрывает, клик по самому файлу нет.
        onClick={(event) => event.target === event.currentTarget && onClose()}
      >
        <ViewerMedia key={item.id} item={item} />
        {hasPrev && (
          <IconButton
            label="Предыдущий файл"
            tooltipText=""
            className="absolute left-3 top-1/2 -translate-y-1/2 bg-canvas"
            onClick={() => onIndex(index - 1)}
          >
            <ChevronLeft className="size-4" strokeWidth={1.7} />
          </IconButton>
        )}
        {hasNext && (
          <IconButton
            label="Следующий файл"
            tooltipText=""
            className="absolute right-3 top-1/2 -translate-y-1/2 bg-canvas"
            onClick={() => onIndex(index + 1)}
          >
            <ChevronRight className="size-4" strokeWidth={1.7} />
          </IconButton>
        )}
      </div>
    </div>
  );
}

// Одно открытое медиа: состояние загрузки и увеличение живут здесь, а ключ по id
// сбрасывает их при листании, чтобы следующий файл открывался обычным размером.
function ViewerMedia({ item }: { item: ViewerItem }) {
  const media = useMediaLoad();
  const [zoomed, setZoomed] = useState(false);
  const src = media.url(item.src);
  const loading = media.status === 'loading';

  if (media.status === 'error')
    return <MediaError name={item.name} onRetry={media.retry} className="max-w-md" />;

  // Пока файл идёт, он невидим, но уже грузится: поверх крутится индикатор.
  const hidden = 'sr-only';
  return (
    <>
      {loading && <Spinner size="xl" label="Загрузка файла" className="text-ink-soft" />}
      {item.kind === 'image' ? (
        <button
          type="button"
          onClick={() => setZoomed((value) => !value)}
          aria-label={zoomed ? 'Уменьшить' : 'Увеличить'}
          className={`${zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in'} ${loading ? hidden : ''}`}
        >
          <img
            key={media.attempt}
            src={src}
            alt={item.name}
            onLoad={media.onReady}
            onError={media.onError}
            className={
              zoomed ? 'max-w-none' : 'max-h-[calc(100dvh-8rem)] max-w-full object-contain'
            }
          />
        </button>
      ) : (
        <video
          key={media.attempt}
          controls
          autoPlay
          playsInline
          src={src}
          aria-label={item.name}
          onLoadedData={media.onReady}
          onError={media.onError}
          className={loading ? hidden : 'max-h-[calc(100dvh-8rem)] max-w-full'}
        />
      )}
    </>
  );
}
