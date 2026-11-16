import LoginForm from '@/components/LoginForm';

export const dynamic = 'force-dynamic';

export default function LoginPage() {
  return <LoginForm passwordLogin={process.env.MOCK_B24 === '1'} />;
}
