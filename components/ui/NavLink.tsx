'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';

interface NavLinkProps {
  href: string;
  children: React.ReactNode;
}

export function NavLink({ href, children }: NavLinkProps) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      className={clsx(
        'flex items-center gap-2 px-3 py-2 text-sm rounded-md mx-2 transition-colors',
        isActive
          ? 'bg-white/15 text-white font-medium'
          : 'text-gray-300 hover:bg-white/10 hover:text-white',
      )}
    >
      {children}
    </Link>
  );
}
