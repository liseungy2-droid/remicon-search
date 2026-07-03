'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AdminPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [result, setResult] = useState<{ total: number; success: number; failed: number } | null>(null);
  const [error, setError] = useState('');
  const [count, setCount] = useState<number | null>(null);
  const router = useRouter();

  const [locked, setLocked] = useState(true);
  const [pw, setPw] = useState('');
  const [pwError, setPwError] = useState('');
  const [pwLoading, setPwLoading] = useState(false);

  useEffect(() => {
    if (sessionStorage.getItem('admin_unlocked') === 'true') setLocked(false);
  }, []);

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwLoading(true);
    setPwError('');
    try {
      const res = await fetch('/api/admin-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: pw }),
      });
      if (res.ok) {
        sessionStorage.setItem('admin_unlocked', 'true');
        setLocked(false);
      } else {
        setPwError('비밀번호가 올바르지 않습니다.');
        setPw('');
      }
    } finally {
      setPwLoading(false);
    }
  };

  useEffect(() => {
    if (!locked) {
      fetch('/api/companies')
        .then(r => r.json())
        .then(d => setCount(d.count));
    }
  }, [locked]);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError('');
    setResult(null);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || '업로드 실패');
      } else {
        setResult(data);
        setCount(data.success);
      }
    } finally {
      setUploading(false);
    }
  };

  const handleLogout = async () => {
    sessionStorage.removeItem('admin_unlocked');
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/');
  };

  if (locked) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <form onSubmit={handleUnlock} className="bg-white border border-gray-200 rounded-xl shadow-sm p-8 w-full max-w-sm space-y-5">
          <div className="text-center">
            <img src="/logo_trimmed.png" alt="유진기업 로고" className="h-10 w-auto mx-auto mb-3 object-contain" />
            <p className="text-xs text-gray-400 tracking-wide">유진기업(주) 수주영업팀</p>
            <h2 className="text-sm font-semibold text-gray-900 mt-0.5">현장 지도 제작(ConMap)</h2>
            <p className="text-xs text-gray-400 mt-3">데이터 관리 · 비밀번호를 입력하세요.</p>
          </div>
          <div>
            <input
              type="password"
              value={pw}
              onChange={e => setPw(e.target.value)}
              placeholder="비밀번호"
              autoFocus
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-gray-900 text-center tracking-widest"
            />
            {pwError && <p className="text-xs text-red-500 mt-1.5 text-center">{pwError}</p>}
          </div>
          <button
            type="submit"
            disabled={!pw || pwLoading}
            className="w-full bg-[#0a0a0a] hover:bg-[#333] text-white py-2 rounded-md text-sm font-medium disabled:opacity-50 transition-colors"
          >
            {pwLoading ? '확인 중...' : '확인'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">데이터 관리</h1>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-400 hover:text-gray-700 underline"
        >
          로그아웃
        </button>
      </div>

      {/* 현황 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm">
        <p className="text-xs text-gray-500 mb-1">현재 등록된 레미콘사</p>
        <p className="text-3xl font-bold text-gray-900">
          {count !== null ? count.toLocaleString() : '...'}
          <span className="text-base font-normal text-gray-500 ml-1">개 업체</span>
        </p>
      </div>

      {/* 업로드 */}
      <div className="bg-white border border-gray-200 rounded-lg p-5 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-gray-800 mb-1">레미콘사 목록 업로드</h2>
          <p className="text-xs text-gray-500 leading-relaxed">
            엑셀 파일(.xlsx, .xls)을 업로드하면 기존 데이터를 전체 교체합니다.<br />
            필수 컬럼:{' '}
            <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">업체명</code>{' '}
            <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">소재지</code>{' '}
            <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">전화</code>{' '}
            <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">생산능력</code>{' '}
            <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700">믹서트럭(대)</code>
          </p>
        </div>

        <div className="flex gap-3 items-center">
          <label className="flex-1 cursor-pointer">
            <input
              type="file"
              accept=".xlsx,.xls"
              onChange={e => {
                setFile(e.target.files?.[0] || null);
                setResult(null);
                setError('');
              }}
              className="block w-full text-sm text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-sm file:font-medium file:bg-gray-100 file:text-gray-700 hover:file:bg-gray-200"
            />
          </label>
          <button
            onClick={handleUpload}
            disabled={!file || uploading}
            className="bg-[#0a0a0a] hover:bg-[#333] text-white px-4 py-2 rounded-md text-sm font-medium disabled:opacity-50 transition-colors whitespace-nowrap"
          >
            {uploading ? '업로드 중...' : '업로드'}
          </button>
        </div>

        {uploading && (
          <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
            <p className="text-sm text-blue-700">주소를 지도에 매핑하는 중입니다. 업체 수에 따라 1~3분 소요됩니다...</p>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-3">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {result && (
          <div className="bg-green-50 border border-green-200 rounded-md p-3">
            <p className="text-sm text-green-800 font-medium">업로드 완료</p>
            <p className="text-sm text-green-700 mt-0.5">
              전체 {result.total}개 중 {result.success}개 지도 매핑 성공
              {result.failed > 0 && (
                <span className="text-orange-600"> · {result.failed}개 주소 매핑 실패 (검색 제외)</span>
              )}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
