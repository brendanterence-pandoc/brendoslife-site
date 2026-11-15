import { useEffect, type ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { CalendarCheck, Database, LineChart, Moon, Pill, Sun } from "lucide-react";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/", label: "Today", icon: CalendarCheck },
  { href: "/trends", label: "Trends", icon: LineChart },
  { href: "/regimen", label: "Regimen", icon: Pill },
  { href: "/data", label: "Data", icon: Database },
];

export function Logo() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7 shrink-0" aria-label="MedTrack" role="img">
      <rect width="32" height="32" rx="7" className="fill-primary" />
      <path d="M6 20.5h4.2l2.6-8 3.8 12 2.9-8.2 1.6 4.2H26" fill="none" className="stroke-primary-foreground" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="24.5" cy="8.5" r="2.6" className="fill-gold" />
    </svg>
  );
}

export default function AppShell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [loc]);
  const { dark, toggle } = useTheme();
  const isActive = (href: string) => (href === "/" ? loc === "/" : loc.startsWith(href));
  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-30 border-b bg-background/95 backdrop-blur-sm">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2" data-testid="link-home">
            <Logo />
            <span className="text-base font-semibold tracking-tight">MedTrack</span>
          </Link>
          <nav className="ml-6 hidden items-center gap-1 md:flex" aria-label="Main">
            {TABS.map((t) => (
              <Link
                key={t.href}
                href={t.href}
                data-testid={`nav-${t.label.toLowerCase()}`}
                className={cn(
                  "rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground",
                  isActive(t.href) && "bg-secondary text-foreground",
                )}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <button
            type="button"
            onClick={toggle}
            data-testid="button-theme"
            aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}
            className="ml-auto flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
          >
            {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-28 pt-4 md:pb-12 md:pt-6">{children}</main>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-30 border-t bg-card md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="mx-auto grid max-w-lg grid-cols-4">
          {TABS.map((t) => {
            const on = isActive(t.href);
            return (
              <Link
                key={t.href}
                href={t.href}
                data-testid={`tab-${t.label.toLowerCase()}`}
                aria-current={on ? "page" : undefined}
                className={cn("flex h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium", on ? "text-primary" : "text-muted-foreground")}
              >
                <t.icon className="h-5 w-5" strokeWidth={on ? 2.4 : 1.8} />
                {t.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
