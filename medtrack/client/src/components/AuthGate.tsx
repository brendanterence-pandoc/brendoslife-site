import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/AppShell";
import { fieldCls } from "@/components/bits";
import { API_BASE, AUTH_ENABLED, SECURITY_CHECK_EVENT, SIGNED_OUT_EVENT, isSecurityCheck, queryClient } from "@/lib/queryClient";

type Phase = "checking" | "in" | "out" | "unset" | "offline" | "check";

/** Passcode sign-in for the hosted copy. The preview build has no sign-in and renders straight through. */
export default function AuthGate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>(AUTH_ENABLED ? "checking" : "in");
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/status`);
      if (isSecurityCheck(res)) return setPhase("check");
      if (!res.ok) throw new Error();
      const s = (await res.json()) as { configured: boolean; signedIn: boolean };
      setPhase(s.signedIn ? "in" : s.configured ? "out" : "unset");
    } catch {
      setPhase("offline");
    }
  }, []);

  useEffect(() => {
    if (!AUTH_ENABLED) return;
    check();
    const onSignedOut = () => {
      queryClient.clear();
      setPhase("out");
    };
    const onSecurityCheck = () => setPhase("check");
    window.addEventListener(SIGNED_OUT_EVENT, onSignedOut);
    window.addEventListener(SECURITY_CHECK_EVENT, onSecurityCheck);
    return () => {
      window.removeEventListener(SIGNED_OUT_EVENT, onSignedOut);
      window.removeEventListener(SECURITY_CHECK_EVENT, onSecurityCheck);
    };
  }, [check]);

  if (phase === "in") return <>{children}</>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!passcode.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      if (isSecurityCheck(res)) return setPhase("check");
      if (res.ok) {
        setPasscode("");
        queryClient.clear();
        setPhase("in");
        return;
      }
      let message = "Sign-in failed. Try again.";
      try {
        message = (await res.json()).message ?? message;
      } catch {}
      if (res.status === 503) setPhase("unset");
      else setError(message);
    } catch {
      setError("Could not reach the tracker. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-background px-5 py-10">
      <main className="w-full max-w-sm rounded-lg border bg-card p-6">
        <div className="flex items-center gap-2">
          <Logo />
          <span className="text-base font-semibold tracking-tight">MedTrack</span>
        </div>
        {phase === "checking" && <p className="mt-6 text-sm text-muted-foreground" data-testid="text-auth-checking">Opening your tracker</p>}
        {phase === "offline" && (
          <div className="mt-6" role="alert">
            <p className="text-sm font-medium">Could not reach the tracker</p>
            <p className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</p>
            <Button className="mt-4 min-h-12 w-full" onClick={() => { setPhase("checking"); check(); }} data-testid="button-auth-retry">Try again</Button>
          </div>
        )}
        {phase === "check" && (
          <div className="mt-6" role="alert" data-testid="text-auth-security-check">
            <h1 className="text-xl font-semibold tracking-tight">Quick security check</h1>
            <p className="mt-2 text-sm text-muted-foreground">The site wants to confirm this is a real browser. Reload to continue. Your entries are safe.</p>
            <Button className="mt-4 min-h-12 w-full" onClick={() => window.location.reload()} data-testid="button-auth-reload">Reload</Button>
          </div>
        )}
        {phase === "unset" && (
          <div className="mt-6" data-testid="text-auth-unset">
            <h1 className="text-xl font-semibold tracking-tight">Almost ready</h1>
            <p className="mt-2 text-sm text-muted-foreground">This tracker is locked until its passcode is set. Finish the passcode step in your assistant conversation, then come back here.</p>
            <Button variant="outline" className="mt-4 min-h-12 w-full" onClick={() => { setPhase("checking"); check(); }} data-testid="button-auth-recheck">Check again</Button>
          </div>
        )}
        {phase === "out" && (
          <form className="mt-6" onSubmit={submit}>
            <h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Private tracker. This device stays signed in after the first time.</p>
            <label htmlFor="passcode" className="mt-5 block text-sm font-medium">Passcode</label>
            <input
              id="passcode"
              type="password"
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={passcode}
              onChange={(e) => setPasscode(e.target.value)}
              className={`${fieldCls} mt-1.5 h-12`}
              data-testid="input-passcode"
              aria-describedby={error ? "passcode-error" : undefined}
              aria-invalid={error ? true : undefined}
            />
            {error && <p id="passcode-error" role="alert" className="mt-2 text-sm text-destructive" data-testid="text-auth-error">{error}</p>}
            <Button type="submit" className="mt-4 min-h-12 w-full" disabled={busy || !passcode.trim()} data-testid="button-sign-in">
              {busy ? "Signing in" : "Sign in"}
            </Button>
          </form>
        )}
      </main>
    </div>
  );
}
