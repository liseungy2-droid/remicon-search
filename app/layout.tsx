import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '레미콘사 검색',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body className="font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
