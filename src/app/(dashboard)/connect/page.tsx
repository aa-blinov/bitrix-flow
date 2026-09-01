'use client';
import { useEffect, useState } from 'react';
import { Plug, CheckCircle2, RefreshCw, ArrowRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function ConnectPage() {
  const [status, setStatus] = useState<'loading' | 'connected' | 'error'>('loading');
  const [domain, setDomain] = useState<string | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);

  useEffect(() => {
    // Проверяем OAuth success в URL
    const params = new URLSearchParams(window.location.search);
    if (params.get('install') === 'success' || params.get('oauth') === 'success') {
      // Получаем member_id с сервера
      checkStatus().then((data: any) => {
        if (data.member_id) {
          localStorage.setItem('bitrix_member_id', data.member_id);
          setMemberId(data.member_id);
          setStatus('connected');
          if (data.domain) setDomain(data.domain);
          const next = sessionStorage.getItem('bitrix-connect-next') || '/';
          sessionStorage.removeItem('bitrix-connect-next');
          window.location.replace(next.startsWith('/') ? next : '/');
        }
      });
      return;
    }

    checkStatus();
  }, []);

  async function checkStatus() {
    try {
      const res = await fetch('/api/oauth/check', {
        headers: { 'X-Member-Id': localStorage.getItem('bitrix_member_id') || '' },
      });
      const data = await res.json();

      if (data.connected) {
        localStorage.setItem('bitrix_member_id', data.member_id);
        setMemberId(data.member_id);
        setStatus('connected');
        if (data.domain) setDomain(data.domain);
      } else {
        setStatus('error');
      }
    } catch {
      setStatus('error');
    }
  }

  const handleConnect = () => {
    const next = new URLSearchParams(window.location.search).get('next');
    if (next?.startsWith('/')) sessionStorage.setItem('bitrix-connect-next', next);
    window.location.href = '/api/oauth';
  };

  return (
    <div className="min-h-screen bg-muted/30 p-4 lg:p-8">
      <div className="max-w-2xl mx-auto">
        <h1 className="mb-2 text-2xl font-semibold">Подключение к Битрикс24</h1>
        <p className="mb-8 text-muted-foreground">
          Подключите свой аккаунт Битрикс24 для управления задачами
        </p>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <div
                className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  status === 'connected' ? 'bg-green-100' : 'bg-gray-100'
                }`}
              >
                {status === 'connected' ? (
                  <CheckCircle2 className="text-green-600" size={24} />
                ) : status === 'loading' ? (
                  <RefreshCw className="text-gray-400 animate-spin" size={24} />
                ) : (
                  <Plug className="text-gray-400" size={24} />
                )}
              </div>
              <div>
                <CardTitle>
                  {status === 'connected'
                    ? 'Подключено'
                    : status === 'loading'
                      ? 'Загрузка...'
                      : 'Не подключено'}
                </CardTitle>
                {domain && <CardDescription>{domain}</CardDescription>}
                {memberId && (
                  <Badge variant="outline" className="mt-2">
                    OAuth ID {memberId}
                  </Badge>
                )}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button onClick={handleConnect} className="w-full" size="lg">
              {status === 'connected' ? 'Переподключить' : 'Подключить Битрикс24'}
              <ArrowRight size={16} />
            </Button>
          </CardContent>
        </Card>

        <Card className="mt-6 border-primary/20 bg-primary/5">
          <CardHeader>
            <CardTitle>Как это работает</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>• Запросы от вашего имени (нет лимитов)</li>
              <li>• Real-time обновления через webhook</li>
              <li>• Автоматический refresh токена</li>
              <li>• Безопасное хранение в MongoDB</li>
              <li>• Webhook больше НЕ используется</li>
            </ul>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
