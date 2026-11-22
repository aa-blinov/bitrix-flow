'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  Check,
  CheckCheck,
  Download,
  ExternalLink,
  FileText,
  Paperclip,
  Pause,
  Play,
  PlayCircle,
} from 'lucide-react';
import { Button } from '@/components/monos/Button';
import { Popover } from '@/components/monos/Popover';
import { Skeleton } from '@/components/monos/Skeleton';
import { Spinner } from '@/components/monos/Spinner';
import BitrixText from '@/components/BitrixText';
import { MediaError, useMediaLoad } from '@/components/MediaState';
import {
  VOICE_NAME,
  fileUrl,
  formatBytes,
  type Attach,
  type MessageFile,
  type Reader,
} from '@/lib/messenger';
import { internalHref } from '@/lib/portal-links';
import { safeHref } from '@/lib/safe-url';
import { t } from '@/lib/i18n';

export function ReadMark({
  readers,
  unread = [],
  group,
}: {
  readers: Reader[];
  /** Участники, которые ещё не дошли до этого сообщения. */
  unread?: Reader[];
  group: boolean;
}) {
  const seen = readers.length > 0;
  const label = seen
    ? t('Прочитано: {0}', readers.map((r) => r.name).join(', '))
    : t('Не прочитано');
  const icon = (
    <>
      {seen ? (
        <CheckCheck className="size-3.5" strokeWidth={1.7} />
      ) : (
        <Check className="size-3.5" strokeWidth={1.7} />
      )}
      {group && seen && <span>{readers.length}</span>}
    </>
  );
  const classes = `inline-flex items-center gap-0.5 ${seen ? 'text-accent-text' : ''}`;
  // В группе список читателей открывается по нажатию: в подсказке не поместилось бы.
  if (!group)
    return (
      <span role="img" aria-label={label} title={label} className={classes}>
        {icon}
      </span>
    );
  return (
    <Popover
      placement="top"
      trigger={
        <button
          type="button"
          aria-label={label}
          onClick={(event) => event.stopPropagation()}
          className={classes}
        >
          {icon}
        </button>
      }
    >
      <div className="w-56 space-y-2 text-xs text-ink">
        <div>
          <p className="font-medium">{t('Прочитали')}</p>
          <p className="text-ink-soft">
            {readers.map((r) => r.name).join(', ') || t('Пока никто')}
          </p>
        </div>
        {unread.length > 0 && (
          <div>
            <p className="font-medium">{t('Не прочитали')}</p>
            <p className="text-ink-soft">{unread.map((r) => r.name).join(', ')}</p>
          </div>
        )}
      </div>
    </Popover>
  );
}

const SPEEDS = [1, 1.5, 2];

const clock = (sec: number) => {
  const s = Math.floor(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

// Свой плеер вместо controls: нативный белый и не попадает в палитру ни в одной теме.
function AudioPlayer({
  src,
  name,
  isVoice,
  media,
}: {
  src: string;
  name: string;
  isVoice: boolean;
  media: ReturnType<typeof useMediaLoad>;
}) {
  const audio = useRef<HTMLAudioElement>(null);
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // Запись MediaRecorder (webm) приходит без длительности: Chrome отдаёт Infinity, пока не
  // дочитает файл. Перемотка в конец заставляет его дочитать, потом возвращаемся в начало.
  const probing = useRef(false);

  const readDuration = () => {
    const el = audio.current;
    if (!el) return;
    if (Number.isFinite(el.duration)) {
      setDuration(el.duration);
      if (probing.current) {
        probing.current = false;
        el.currentTime = 0;
      }
    } else if (!probing.current) {
      probing.current = true;
      el.currentTime = 1e7;
    }
  };

  return (
    <div className="mt-0.5 flex w-72 max-w-full items-center gap-2">
      <audio
        ref={audio}
        // У голосового сразу видна длительность; обычный звук грузится по нажатию.
        preload={isVoice ? 'metadata' : 'none'}
        src={src}
        aria-label={name}
        onWaiting={media.onLoading}
        onCanPlay={media.onReady}
        onPlaying={media.onReady}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onLoadedMetadata={() => {
          if (audio.current) audio.current.playbackRate = rate;
          readDuration();
        }}
        onDurationChange={readDuration}
        onTimeUpdate={() => {
          if (!probing.current) setTime(audio.current?.currentTime ?? 0);
        }}
        onError={media.onError}
        className="hidden"
      />
      <button
        type="button"
        aria-label={playing ? t('Пауза') : t('Воспроизвести')}
        onClick={() => {
          const el = audio.current;
          if (!el) return;
          if (el.paused) void el.play().catch(media.onError);
          else el.pause();
        }}
        className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-surface-2 text-ink hover:border-line-strong"
      >
        {media.status === 'loading' && playing ? (
          <Spinner label={t('Загрузка файла')} size="sm" />
        ) : playing ? (
          <Pause className="size-4" strokeWidth={2} fill="currentColor" />
        ) : (
          <Play className="ml-0.5 size-4" strokeWidth={2} fill="currentColor" />
        )}
      </button>
      <input
        type="range"
        min={0}
        max={duration || 0}
        step="any"
        value={Math.min(time, duration || 0)}
        disabled={!duration}
        aria-label={t('Перемотка')}
        onChange={(event) => {
          const next = Number(event.target.value);
          setTime(next);
          if (audio.current) audio.current.currentTime = next;
        }}
        className="h-1 min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-default"
      />
      <span className="shrink-0 text-xs text-ink-soft tabular-nums">
        {clock(playing || time ? time : duration)}
      </span>
      <button
        type="button"
        aria-label={t('Скорость воспроизведения {0}×', rate)}
        onClick={() => {
          const next = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
          setRate(next);
          if (audio.current) audio.current.playbackRate = next;
        }}
        className="shrink-0 rounded-ui border border-line px-1.5 py-0.5 text-xs text-ink-soft hover:text-ink"
      >
        {rate}×
      </button>
    </div>
  );
}

// Подпись под медиа: имя файла, у голосового вместо длинного имени с датой понятная метка.
function Caption({ children }: { children: string }) {
  return <span className="mt-0.5 block max-w-64 truncate text-xs text-ink-soft">{children}</span>;
}

export function FileView({
  file,
  dialogId,
  onOpen,
}: {
  file: MessageFile;
  dialogId: string;
  onOpen: (id: number) => void;
}) {
  // Звук не грузится, пока его не включат (preload none): до этого он готов.
  const media = useMediaLoad(file.kind === 'audio' ? 'ready' : 'loading');
  const src = media.url(fileUrl(dialogId, file));
  const isVoice = file.name.startsWith(VOICE_NAME);

  if (file.kind === 'image' || file.kind === 'video') {
    if (media.status === 'error') return <MediaError name={file.name} onRetry={media.retry} />;
    const loading = media.status === 'loading';
    // Место под файл занимает заглушка, а сам файл догружается поверх невидимым:
    // так переписка не прыгает, и ленивая загрузка картинки остаётся ленивой.
    const hidden = 'absolute inset-0 size-full opacity-0';
    return (
      <div className="mt-1">
        <button
          type="button"
          onClick={() => onOpen(file.id)}
          aria-label={file.kind === 'video' ? t('Открыть видео {0}', file.name) : undefined}
          className={`relative block ${file.kind === 'image' ? 'cursor-zoom-in' : ''}`}
        >
          {loading && (
            <span className="relative block h-40 w-56 max-w-full">
              <Skeleton width="100%" height="100%" />
              <Spinner
                label={t('Загрузка файла')}
                className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-ink-soft"
              />
            </span>
          )}
          {file.kind === 'image' ? (
            <img
              key={media.attempt}
              src={src}
              alt={file.name}
              loading="lazy"
              onLoad={media.onReady}
              onError={media.onError}
              className={loading ? hidden : 'max-h-64 max-w-full rounded-ui'}
            />
          ) : (
            <>
              <video
                key={media.attempt}
                preload="metadata"
                muted
                playsInline
                src={src}
                onLoadedData={media.onReady}
                onError={media.onError}
                className={loading ? hidden : 'max-h-64 max-w-full rounded-ui'}
              />
              {!loading && (
                <PlayCircle
                  className="absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 text-ink"
                  strokeWidth={1.4}
                />
              )}
            </>
          )}
        </button>
        <Caption>{`${file.name} · ${formatBytes(file.size)}`}</Caption>
      </div>
    );
  }
  if (file.kind === 'audio') {
    if (media.status === 'error') return <MediaError name={file.name} onRetry={media.retry} />;
    return (
      <div className="mt-1">
        <Caption>{isVoice ? t('Голосовое сообщение') : file.name}</Caption>
        <AudioPlayer
          key={media.attempt}
          src={src}
          name={file.name}
          isVoice={isVoice}
          media={media}
        />
      </div>
    );
  }
  // Что браузер показывает сам (pdf, текст), можно открыть в новой вкладке, а не только скачать.
  const viewable = /\.(pdf|txt)$/i.test(file.name);
  return (
    <div className="mt-1 flex items-center gap-1">
      <a
        href={fileUrl(dialogId, file, true)}
        download={file.name}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-ui border border-line px-2 py-1.5 text-sm text-ink hover:bg-surface-2"
      >
        <FileText className="size-4 shrink-0 text-ink-soft" strokeWidth={1.7} />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <span className="shrink-0 text-xs text-ink-soft">{formatBytes(file.size)}</span>
        <Download className="size-4 shrink-0 text-ink-soft" strokeWidth={1.7} />
      </a>
      {viewable && (
        <a
          href={fileUrl(dialogId, file)}
          target="_blank"
          rel="noreferrer"
          aria-label={t('Открыть {0} в новой вкладке', file.name)}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-ui text-ink-soft hover:bg-surface-2 hover:text-ink max-sm:size-11"
        >
          <ExternalLink className="size-4" strokeWidth={1.7} />
        </a>
      )}
    </div>
  );
}

export function AttachView({ attach }: { attach: Attach }) {
  return (
    <div className="mt-1 space-y-1 border-l-2 border-line pl-3 text-sm text-ink">
      {attach.description && <p className="text-xs text-ink-soft">{attach.description}</p>}
      {attach.blocks.map((block, index) => {
        if (block.type === 'text')
          return (
            <div key={index}>
              <BitrixText text={block.text} markdown />
            </div>
          );
        if (block.type === 'user')
          return (
            <p key={index} className="text-xs font-medium text-accent-text">
              {block.name}
            </p>
          );
        if (block.type === 'link')
          return (
            <div key={index}>
              {internalHref(block.link) ? (
                <Link href={internalHref(block.link)!} className="text-accent-text hover:underline">
                  {block.name}
                </Link>
              ) : (
                <a
                  href={safeHref(block.link)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-accent-text hover:underline"
                >
                  {block.name}
                </a>
              )}
              {block.desc && <p className="line-clamp-3 text-xs text-ink-soft">{block.desc}</p>}
              {/* Картинку превью портал берёт с самого сайта. no-referrer: сайту незачем
                  знать, из какого чата по ней пришли. */}
              {block.preview && (
                // eslint-disable-next-line @next/next/no-img-element -- чужой адрес, не наша статика
                <img
                  src={block.preview}
                  alt=""
                  loading="lazy"
                  referrerPolicy="no-referrer"
                  className="mt-1 max-h-40 w-auto max-w-full rounded-ui border border-line object-cover"
                />
              )}
            </div>
          );
        if (block.type === 'grid')
          return (
            <dl key={index} className="grid grid-cols-[auto_1fr] gap-x-3 text-xs">
              {block.rows.map((row, rowIndex) => (
                <div key={rowIndex} className="contents">
                  <dt className="text-ink-soft">{row.name}</dt>
                  <dd>{row.value}</dd>
                </div>
              ))}
            </dl>
          );
        if (block.type === 'files')
          return (
            <p key={index} className="flex items-center gap-1 text-xs text-ink-soft">
              <Paperclip className="size-3.5" strokeWidth={1.7} />
              {block.names.join(', ')}
            </p>
          );
        return <hr key={index} className="border-line" />;
      })}
    </div>
  );
}
