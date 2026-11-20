'use client';

import PageHeader from '@/components/PageHeader';
import DigestSettings from '@/components/settings/DigestSettings';
import HoursSettings from '@/components/settings/HoursSettings';
import { t } from '@/lib/i18n';

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <PageHeader
        title={t('Настройки')}
        description={t('Общие настройки BitrixFlow для всей команды. Меняет только администратор')}
      />
      <div className="mx-auto max-w-3xl space-y-10 p-4 lg:p-6">
        <HoursSettings />
        <DigestSettings />
      </div>
    </div>
  );
}
