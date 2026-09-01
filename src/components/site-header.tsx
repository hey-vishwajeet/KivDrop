"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const links = [
  { href: "/send", label: "Send" },
  { href: "/receive", label: "Receive" },
  { href: "/history", label: "History" },
  { href: "/settings", label: "Settings" },
];

export function SiteHeader() {
  const pathname = usePathname();
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link className="wordmark" href="/" aria-label="KivDrop home">
          <Image src="/logo.png" alt="KivDrop Logo" className="brand-mark" width={28} height={28} style={{ objectFit: 'contain', borderRadius: '4px' }} />
          <span>KivDrop</span>
        </Link>
        <nav aria-label="Primary navigation" className="desktop-nav">
          {links.map((link) => (
            <Link
              aria-current={pathname.startsWith(link.href) ? "page" : undefined}
              href={link.href}
              key={link.href}
            >
              {link.label}
            </Link>
          ))}
        </nav>
        <details className="mobile-nav">
          <summary aria-label="Open navigation">Menu</summary>
          <nav aria-label="Mobile navigation">
            {links.map((link) => (
              <Link
                aria-current={pathname.startsWith(link.href) ? "page" : undefined}
                href={link.href}
                key={link.href}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </details>
      </div>
    </header>
  );
}
