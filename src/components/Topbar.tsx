import Link from "next/link";

export function Topbar({ children }: { children?: React.ReactNode }) {
  return (
    <header className="topbar">
      <Link className="brand" href="/">
        <span className="brand-mark" aria-hidden="true" />
        <span>
          Qairu<b>Cowork</b>
        </span>
      </Link>
      <span className="spacer" />
      {children}
    </header>
  );
}
