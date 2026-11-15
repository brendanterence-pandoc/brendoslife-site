import type { ReactNode } from "react";
import { Activity, Syringe } from "lucide-react";
import type { Item } from "@shared/schema";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { tone, useTheme } from "@/lib/theme";

/** Small pill / tracker glyph. Shape follows the medication form, fill follows its color. */
export function ItemIcon({ item, className }: { item: Pick<Item, "kind" | "form" | "color">; className?: string }) {
  const { dark } = useTheme();
  const box = cn("flex h-10 w-10 shrink-0 items-center justify-center", className);
  if (item.kind === "tracker") {
    const c = tone(item.color, dark);
    return (
      <span className={cn(box, "rounded-full")} style={{ backgroundColor: `${c}22`, color: c }}>
        <Activity className="h-5 w-5" />
      </span>
    );
  }
  if (item.form === "injection") {
    return (
      <span className={cn(box, "text-muted-foreground")}>
        <Syringe className="h-6 w-6" />
      </span>
    );
  }
  const stroke = dark ? "rgba(255,255,255,.28)" : "rgba(20,30,60,.28)";
  return (
    <span className={box}>
      <svg viewBox="0 0 40 40" className="h-9 w-9" aria-hidden="true">
        {item.form === "capsule" ? (
          <g>
            <rect x="5" y="13" width="30" height="14" rx="7" fill="#FBFAF7" stroke={stroke} />
            <path d="M12 13h8v14h-8a7 7 0 0 1 0-14z" fill={item.color} />
          </g>
        ) : item.form === "caplet" ? (
          <g>
            <rect x="5" y="12.5" width="30" height="15" rx="7.5" fill={item.color} stroke={stroke} />
            <line x1="20" y1="14.5" x2="20" y2="25.5" stroke={stroke} />
          </g>
        ) : (
          <g>
            <circle cx="20" cy="20" r="12.5" fill={item.color} stroke={stroke} />
            <line x1="12.5" y1="25" x2="27.5" y2="15" stroke={stroke} />
          </g>
        )}
      </svg>
    </span>
  );
}

export function BottomSheet({
  open, onOpenChange, title, description, children,
}: { open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children: ReactNode }) {
  return (
    <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
      <DrawerContent className="mx-auto max-h-[92dvh] max-w-lg">
        <DrawerHeader className="px-4 pb-2 pt-3 text-left">
          <DrawerTitle className="text-lg font-semibold tracking-tight">{title}</DrawerTitle>
          <DrawerDescription className={description ? "text-sm text-muted-foreground" : "sr-only"}>{description ?? title}</DrawerDescription>
        </DrawerHeader>
        <div className="overflow-y-auto px-4 pb-6" style={{ paddingBottom: "calc(1.5rem + env(safe-area-inset-bottom))" }}>
          {children}
        </div>
      </DrawerContent>
    </Drawer>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-2 mt-6 flex min-h-9 items-center justify-between gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{children}</h2>
      {action}
    </div>
  );
}

export function Panel({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-lg border border-card-border bg-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed px-4 py-8 text-center">
      <p className="text-sm font-medium">{title}</p>
      {children && <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">{children}</p>}
    </div>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 px-4 py-4 text-sm" role="alert">
      <p className="font-medium">Could not load your data</p>
      <p className="mt-1 text-muted-foreground">{error instanceof Error ? error.message : "Check your connection and try again."}</p>
      {onRetry && (
        <button type="button" onClick={onRetry} className="mt-2 font-medium text-primary underline underline-offset-4" data-testid="button-retry">
          Try again
        </button>
      )}
    </div>
  );
}

export const fieldCls =
  "h-11 w-full rounded-md border border-input bg-background px-3 text-base text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>}
    </label>
  );
}
