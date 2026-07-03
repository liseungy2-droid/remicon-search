import { NavLink } from '@/components/ui/NavLink';
import { LogoutButton } from '@/components/ui/LogoutButton';
import { Search, Settings } from 'lucide-react';

const navItems = [
  { href: '/search', label: '검색', Icon: Search },
  { href: '/admin', label: '데이터 관리', Icon: Settings },
];

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      <aside className="fixed left-0 top-0 h-full w-52 bg-[#0a0a0a] flex flex-col print:hidden z-10">
        <div className="p-5 border-b border-white/10">
          <img src="/logo_trimmed.png" alt="유진기업 로고" className="h-10 w-auto mb-3 object-contain" />
          <div className="text-white/40 text-xs tracking-wide mb-1">유진기업(주) 수주영업팀</div>
          <div className="text-white text-sm font-semibold">현장 지도 제작(ConMap)</div>
        </div>
        <nav className="flex flex-col py-2 flex-1">
          {navItems.map(({ href, label, Icon }) => (
            <NavLink key={href} href={href}>
              <Icon size={15} />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="border-t border-white/10 py-1">
          <LogoutButton />
        </div>
      </aside>
      <main className="ml-52 flex-1 min-h-screen bg-[#f5f5f5] p-6 print:ml-0 print:p-4">
        {children}
      </main>
    </div>
  );
}
