import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  const { password } = await request.json();
  if (password !== process.env.APP_PASSWORD) {
    return NextResponse.json({ error: '비밀번호 오류' }, { status: 401 });
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set('remicon_auth', 'true', {
    httpOnly: true,
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return response;
}
