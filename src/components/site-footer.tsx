import Link from "next/link";
import Image from "next/image";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="footer-brand">
          <Image src="/logo.png" alt="KivDrop Logo" className="brand-mark" width={22} height={22} style={{ objectFit: 'contain', borderRadius: '4px' }} />
          <span>KivDrop</span>
          <span className="muted">Direct when the network allows it.</span>
        </div>
        <nav aria-label="Footer navigation">
          <Link href="/privacy">Privacy</Link>
          <Link href="/about">About</Link>
        </nav>
      </div>
    </footer>
  );
}
