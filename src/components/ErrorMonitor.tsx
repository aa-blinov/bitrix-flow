'use client';

// Необработанные ошибки браузера в GlitchTip. Своё, а не SDK: нужен один POST
// на событие, и лишние 40 КБ в бандле ради этого ни к чему.
import { useEffect } from 'react';
import { reportError } from '@/lib/error-reporter';

export default function ErrorMonitor() {
  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      reportError(event.error || event.message, {
        route: window.location.pathname,
        tags: { source: 'window.onerror' },
      });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      reportError(event.reason, {
        route: window.location.pathname,
        tags: { source: 'unhandledrejection' },
      });
    };
    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

  return null;
}
