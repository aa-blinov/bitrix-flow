'use client';

import PageHeader from '@/components/PageHeader';
import DigestSettings from '@/components/settings/DigestSettings';
import HoursSettings from '@/components/settings/HoursSettings';
import McpTokens from '@/components/settings/McpTokens';
import { t } from '@/lib/i18n';

export default function SettingsPage() {
  return (
    <div className="min-h-screen bg-canvas">
      <PageHeader
        title={t('Настройки')}
        description={t('Общие настройки команды меняет администратор, токены MCP у каждого свои')}
      />
      <div className="mx-auto max-w-3xl space-y-10 p-4 lg:p-6">
        <HoursSettings />
        <DigestSettings />
        <McpTokens />
      </div>
    </div>
  );
}
