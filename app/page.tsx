'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        sessionStorage.removeItem('admin_unlocked');
        router.push('/search');
      } else {
        setError('비밀번호가 올바르지 않습니다.');
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* 좌측 - 배경 이미지 */}
      <div
        className="flex-1 relative"
        style={{ backgroundImage: 'url(/login-bg.jpg)', backgroundSize: 'cover', backgroundPosition: 'center' }}
      >
        <div className="absolute inset-0 bg-black/30" />
        {/* 좌측 하단 로고 */}
        <div className="absolute bottom-8 left-8">
          <img
            src="/logo_trimmed.png"
            alt="유진기업 로고"
            className="h-8 w-auto object-contain brightness-0 invert opacity-90"
          />
        </div>
      </div>

      {/* 우측 - 로그인 패널 */}
      <div className="w-[340px] bg-[#1e2b3c] flex flex-col justify-center px-10 py-16">
        <div className="mb-10">
          <img src="/logo_trimmed.png" alt="유진기업 로고" className="h-20 w-auto object-contain mb-4" />
          <p className="text-white/50 text-xs tracking-widest uppercase mb-2">유진기업(주) 수주영업팀</p>
          <h1 className="text-white text-lg font-bold leading-snug">현장 지도 제작<br />(ConMap)</h1>
        </div>

        <form onSubmit={handleLogin} className="space-y-3">
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="비밀번호"
            autoFocus
            className="w-full bg-white/10 border border-white/20 rounded px-4 py-3 text-sm text-white placeholder-white/30 focus:outline-none focus:border-blue-400 transition-colors"
          />
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            type="submit"
            disabled={loading || !password}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 rounded text-sm font-bold tracking-widest disabled:opacity-40 transition-colors"
          >
            {loading ? '...' : 'LOGIN'}
          </button>
        </form>
      </div>
    </div>
  );
}
