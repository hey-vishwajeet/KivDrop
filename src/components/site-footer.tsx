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
          <details className="footer-files">
            <summary>File</summary>
            <div className="footer-files__menu">
              <a href="/ai-lab-manual-2026-27.pdf" download>
                AI Lab Manual 2026-27
              </a>
              <a href="/cc-lab-manual-2026-27.pdf" download>
                CC Lab Manual 2026-27
              </a>
            </div>
          </details>
          <Link href="/about">About</Link>
        </nav>
      </div>
    </footer>
  );
}
