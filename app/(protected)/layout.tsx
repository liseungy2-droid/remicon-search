'use client';

import { useRouter } from 'next/navigation';
import { NavLink } from '@/components/ui/NavLink';
import { Search, Settings, LogOut } from 'lucide-react';

const navItems = [
  { href: '/search', label: '현장 검색', Icon: Search },
  { href: '/admin', label: '업체 관리', Icon: Settings },
];

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();

  async function handleLogout() {
    await fetch('/api/auth', { method: 'DELETE' });
    router.push('/');
  }

  return (
    <div className="flex">
      <aside className="fixed left-0 top-0 h-full w-52 bg-[#0a0a0a] flex flex-col z-10">
        <div className="p-5 border-b border-white/10">
          <div className="text-white/40 text-xs font-mono tracking-widest uppercase mb-1">건설사 구매팀</div>
          <div className="text-white text-sm font-semibold">레미콘사 검색</div>
        </div>
        <nav className="flex flex-col py-2 flex-1">
          {navItems.map(({ href, label, Icon }) => (
            <NavLink key={href} href={href}>
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-2 border-t border-white/10">
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 text-sm rounded-md mx-0 w-full text-gray-400 hover:bg-white/10 hover:text-white transition-colors"
          >
            <LogOut size={15} />
            로그아웃
          </button>
        </div>
      </aside>
      <main className="ml-52 min-h-screen bg-[#f5f5f5] w-[calc(100%-13rem)]">{children}</main>
    </div>
  );
}
