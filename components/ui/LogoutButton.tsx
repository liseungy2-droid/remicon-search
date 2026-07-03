'use client';

import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';

export function LogoutButton() {
  const router = useRouter();

  const handleLogout = async () => {
    sessionStorage.removeItem('admin_unlocked');
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  return (
    <button
      onClick={handleLogout}
      className="flex items-center gap-2 px-4 py-2.5 w-full text-sm text-white/40 hover:text-white hover:bg-white/10 transition-colors"
    >
      <LogOut size={15} />
      로그아웃
    </button>
  );
}
