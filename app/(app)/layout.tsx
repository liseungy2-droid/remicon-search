import { NavLink } from '@/components/ui/NavLink';
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
          <div className="text-white/40 text-xs font-mono tracking-widest uppercase mb-1">건설 자재</div>
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
      </aside>
      <main className="ml-52 flex-1 min-h-screen bg-[#f5f5f5] p-6 print:ml-0 print:p-4">
        {children}
      </main>
    </div>
  );
}
