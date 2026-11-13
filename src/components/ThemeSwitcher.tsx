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
    // В сайдбаре места мало, поэтому палитра стоит отдельной строкой: рядом с режимом
    // она не влезала и ломала ширину панели. Под ней режим и то, что передали рядом (язык).
    <div className="flex flex-col gap-2">
      <SelectField
        aria-label={t('Палитра оформления')}
        size="sm"
        variant="boxed"
        value={theme}
        onChange={(event) => setTheme(event.target.value as (typeof THEME_NAMES)[number])}
        options={THEME_NAMES.map((name) => ({ value: name, label: THEME_LABELS[name] }))}
      />
      <div className="flex items-center gap-2">
        <SegmentedControl
          size="sm"
          label={t('Режим оформления')}
          value={mode}
          onChange={(value) => setMode(value === 'dark' ? 'dark' : 'light')}
          options={[
            { value: 'light', label: t('Светлая') },
            { value: 'dark', label: t('Тёмная') },
          ]}
          className="min-w-0 flex-1 [&>button]:flex-1"
        />
        {children}
      </div>
    </div>
  );
}
