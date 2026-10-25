'use client';

import { useState } from 'react';
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { LOCALE_COOKIE, getLocale, t, type Locale } from '@/lib/i18n';

// Смена языка перезагружает страницу: так все строки, в том числе посчитанные при
// загрузке модуля, заново собираются на новом языке.
export default function LanguageSwitcher() {
  const [locale] = useState<Locale>(getLocale());
  return (
    <SegmentedControl
      label={t('Язык интерфейса')}
      size="sm"
      options={[
        { value: 'ru', label: 'RU' },
        { value: 'en', label: 'EN' },
      ]}
      value={locale}
      onChange={(value) => {
        document.cookie = `${LOCALE_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
        window.location.reload();
      }}
    />
  );
}
