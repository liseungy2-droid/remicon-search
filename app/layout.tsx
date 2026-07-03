import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '현장 지도 제작(ConMap)_Eugene Sales',
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
