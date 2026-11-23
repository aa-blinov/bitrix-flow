'use client';

// Переключатель оформления. Палитр и режимов в наборе @monos/ui шесть и два:
// палитра меняет значения токенов, режим — светлое или тёмное.
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { SelectField } from '@/components/monos/SelectField';
import { THEME_LABELS, THEME_NAMES, useTheme } from '@/components/monos/theme';
import { t } from '@/lib/i18n';

export default function ThemeSwitcher({ children }: { children?: React.ReactNode }) {
  const { theme, mode, setTheme, setMode } = useTheme();

  return (
    // В сайдбаре места мало, поэтому каждый выбор своей строкой: палитра, режим, язык.
    // Режим с языком в одной строке не влезали, и «Тёмная» обрезалась вместе с подсветкой.
    <div className="flex flex-col gap-2">
      <SelectField
        aria-label={t('Палитра оформления')}
        size="sm"
        variant="boxed"
        value={theme}
        onChange={(event) => setTheme(event.target.value as (typeof THEME_NAMES)[number])}
        options={THEME_NAMES.map((name) => ({ value: name, label: THEME_LABELS[name] }))}
      />
      <SegmentedControl
        size="sm"
        label={t('Режим оформления')}
        value={mode === 'auto' ? 'auto' : mode}
        onChange={(value) => setMode(value as 'light' | 'dark' | 'auto')}
        options={[
          { value: 'auto', label: t('Системная') },
          { value: 'light', label: t('Светлая') },
          { value: 'dark', label: t('Тёмная') },
        ]}
        className="w-full [&>button]:flex-1"
      />
      {children}
    </div>
  );
}
