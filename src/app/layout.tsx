import type { Metadata, Viewport } from 'next';
import { Cairo } from 'next/font/google';

import './globals.css';

/*
 * The site is Arabic only, so the document is Arabic and right-to-left at the
 * root: there is no locale segment and no routing to choose between languages.
 */

const cairo = Cairo({ subsets: ['arabic'], variable: '--font-ar', display: 'swap' });

export const metadata: Metadata = {
  title: 'جيسي — شريكتك في شؤون الموظفين',
  description:
    'أسئلة وأجوبة عن الإجازات في قانون العمل المصري رقم 14 لسنة 2025: السنوية، العارضة، الامتحان، ' +
    'العطلات الرسمية، الحج، المرضية، الوضع، الرضاعة، ورعاية الطفل.',
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: '#1b2a4a',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable} data-scroll-behavior="smooth">
      <body className="font-sans">{children}</body>
    </html>
  );
}
