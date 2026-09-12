import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <div className="w-full max-w-md rounded-xl border bg-card p-6 text-center">
        <p className="text-sm font-medium text-muted-foreground">Ошибка 404</p>
        <h1 className="mt-1 text-xl font-semibold text-foreground">Страница не найдена</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Ссылка устарела или задачу удалили в Битрикс24.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          На главную
        </Link>
      </div>
    </main>
  );
}
