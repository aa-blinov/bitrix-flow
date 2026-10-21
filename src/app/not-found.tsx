import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas p-6">
      <div className="w-full max-w-md rounded-ui border border-line bg-surface p-6 text-center">
        <p className="text-whisper font-bold uppercase tracking-widest text-ink-faint">
          Ошибка 404
        </p>
        <h1 className="mt-1 text-xl font-bold text-ink">Страница не найдена</h1>
        <p className="mt-2 text-sm text-ink-soft">
          Ссылка устарела или задачу удалили в Битрикс24.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-11 items-center justify-center rounded-ui px-4 text-sm font-bold uppercase tracking-widest text-ink transition-opacity duration-fast hover:opacity-70"
        >
          На главную
        </Link>
      </div>
    </main>
  );
}
