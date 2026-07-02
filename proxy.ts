import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const auth = request.cookies.get('remicon_auth');
  const { pathname } = request.nextUrl;

  const isProtected = pathname.startsWith('/search') || pathname.startsWith('/admin');

  if (isProtected && !auth) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  if (pathname === '/' && auth) {
    return NextResponse.redirect(new URL('/search', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/', '/search', '/admin'],
};
