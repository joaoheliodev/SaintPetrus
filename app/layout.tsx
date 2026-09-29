import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'SaintPetrus', description: 'Local agent graph workspace.' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" className="dark"><body>{children}</body></html>;
}
