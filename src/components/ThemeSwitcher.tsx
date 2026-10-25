'use client';

// Переключатель оформления. Палитр и режимов в наборе @monos/ui шесть и два:
// палитра меняет значения токенов, режим — светлое или тёмное.
import { SegmentedControl } from '@/components/monos/SegmentedControl';
import { SelectField } from '@/components/monos/SelectField';
import { THEME_LABELS, THEME_NAMES, useTheme } from '@/components/monos/theme';
import { t } from '@/lib/i18n';

export default function ThemeSwitcher() {
  const { theme, mode, setTheme, setMode } = useTheme();

  return (
    // В сайдбаре места мало, поэтому палитра и режим стоят друг под другом:
    // в одну строку они не влезали и ломали ширину панели.
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
        value={mode}
        onChange={(value) => setMode(value === 'dark' ? 'dark' : 'light')}
        options={[
          { value: 'light', label: t('Светлая') },
          { value: 'dark', label: t('Тёмная') },
        ]}
        className="w-full [&>button]:flex-1"
      />
    </div>
  );
}
