import Link from 'next/link';
import { Logo } from '@/components/ui';

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-full flex-col bg-bg-subtle">
      <header className="p-6">
        <Link href="/" aria-label="SuperDesk home">
          <Logo />
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-4 pb-16 pt-4 sm:items-center sm:pt-0">
        <div className="w-full max-w-[400px]">{children}</div>
      </main>

      <footer className="px-6 py-5 text-center text-xs text-fg-subtle">
        Live chat, email, and help center in one inbox.
      </footer>
    </div>
  );
}
