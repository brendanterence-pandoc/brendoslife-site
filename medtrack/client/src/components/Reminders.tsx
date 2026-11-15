import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BellOff, BellRing } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { REMINDERS_AVAILABLE, currentSubscription, pushSupport, refreshSubscription, turnOff, turnOn, type PushConfig } from "@/lib/push";
import { fieldCls, Panel, SectionTitle } from "@/components/bits";

const KEY = ["push-config"];
const NUDGES = [
  { value: 0, label: "No second reminder" },
  { value: 15, label: "After 15 minutes" },
  { value: 30, label: "After 30 minutes" },
  { value: 60, label: "After 1 hour" },
];

/** Whether this device is registered for reminders. `null` while checking. */
export function useThisDevice() {
  const [on, setOn] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    if (!REMINDERS_AVAILABLE || pushSupport() !== "ok") return setOn(false);
    refreshSubscription()
      .then((sub) => live && setOn(!!sub))
      .catch(() => currentSubscription().then((sub) => live && setOn(!!sub)).catch(() => live && setOn(false)));
    return () => {
      live = false;
    };
  }, []);
  return [on, setOn] as const;
}

export default function Reminders() {
  const { toast } = useToast();
  const support = pushSupport();
  const [on, setOn] = useThisDevice();
  const [busy, setBusy] = useState(false);
  const config = useQuery<PushConfig>({ queryKey: KEY, queryFn: async () => (await apiRequest("GET", "/api/push/config")).json(), enabled: REMINDERS_AVAILABLE });
  if (!REMINDERS_AVAILABLE) return null;

  const fail = (e: unknown) => toast({ title: "That did not work", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };
  const setConfig = (c: PushConfig | null) => {
    if (c) queryClient.setQueryData(KEY, c);
  };
  const saveSetting = (patch: Partial<Pick<PushConfig, "followupMin" | "showNames">>) =>
    run(async () => {
      setConfig(await (await apiRequest("PUT", "/api/push/settings", patch)).json());
    });

  const blocked = support === "ok" && Notification.permission === "denied";
  const c = config.data;

  return (
    <>
      <SectionTitle>Reminders</SectionTitle>
      <Panel className="p-4" data-testid="panel-reminders">
        {support === "needs-home-screen" ? (
          <div data-testid="text-reminders-home-screen">
            <p className="text-sm font-medium">Add MedTrack to your Home Screen first</p>
            <p className="mt-1 text-sm text-muted-foreground">
              iPhone only delivers reminders to apps on the Home Screen. In Safari, tap Share, then Add to Home Screen. Open MedTrack from the new icon, sign in, and come back to this tab.
            </p>
          </div>
        ) : support === "unsupported" ? (
          <p className="text-sm text-muted-foreground" data-testid="text-reminders-unsupported">This browser cannot receive reminders. On iPhone, use Safari and add MedTrack to your Home Screen.</p>
        ) : blocked ? (
          <div data-testid="text-reminders-blocked">
            <p className="text-sm font-medium">Notifications are turned off for MedTrack</p>
            <p className="mt-1 text-sm text-muted-foreground">Open the Settings app, go to Notifications, choose MedTrack, and allow notifications. Then come back here.</p>
          </div>
        ) : on === null || !c ? (
          <p className="text-sm text-muted-foreground" aria-busy="true">{config.isError ? "Reminder settings could not load. Pull down to refresh and try again." : "Checking this device…"}</p>
        ) : !on ? (
          <div>
            <p className="text-sm text-muted-foreground">
              Get a notification at each scheduled time, and a second one if anything is still open. {c.devices > 0 ? `On for ${c.devices} other ${c.devices === 1 ? "device" : "devices"}.` : ""}
            </p>
            <Button className="mt-3 min-h-12 w-full sm:w-auto" disabled={busy} data-testid="button-reminders-on"
              onClick={() => run(async () => {
                const r = await turnOn(c.publicKey);
                setConfig(r.config);
                setOn(true);
                toast({ title: "Reminders are on", description: "Tap Send a test to check that one arrives." });
              })}>
              <BellRing /> Turn on reminders
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <p className="flex items-center gap-2 text-sm font-medium" data-testid="text-reminders-on"><BellRing className="size-4 text-primary" aria-hidden="true" /> On for this device</p>
            <label className="block">
              <span className="mb-1 block text-sm font-medium">Second reminder if something is still open</span>
              <select className={fieldCls} value={c.followupMin} disabled={busy} onChange={(e) => saveSetting({ followupMin: Number(e.target.value) })} data-testid="select-reminders-nudge">
                {(NUDGES.some((n) => n.value === c.followupMin) ? NUDGES : [...NUDGES, { value: c.followupMin, label: `After ${c.followupMin} minutes` }]).map((n) => (
                  <option key={n.value} value={n.value}>{n.label}</option>
                ))}
              </select>
            </label>
            <div className="flex items-start justify-between gap-4">
              <label htmlFor="reminder-names" className="text-sm">
                <span className="block font-medium">Show names on the notification</span>
                <span className="mt-0.5 block text-muted-foreground">Off shows counts only, so medication names stay off your lock screen.</span>
              </label>
              <Switch id="reminder-names" checked={c.showNames} disabled={busy} onCheckedChange={(v) => saveSetting({ showNames: v })} data-testid="switch-reminders-names" />
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              <Button variant="outline" className="min-h-12" disabled={busy} data-testid="button-reminders-test"
                onClick={() => run(async () => {
                  const r = await (await apiRequest("POST", "/api/push/test", {})).json();
                  if (!r.ok) throw new Error("The test could not be sent. Turn reminders off and on again, then retry.");
                  toast({ title: "Test sent", description: "It should arrive within a few seconds." });
                })}>
                Send a test
              </Button>
              <Button variant="outline" className="min-h-12" disabled={busy} data-testid="button-reminders-off"
                onClick={() => run(async () => {
                  setConfig(await turnOff());
                  setOn(false);
                })}>
                <BellOff /> Turn off on this device
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Times follow this device's time zone ({c.tz.replace(/_/g, " ")}). Focus modes and Do Not Disturb can hold reminders back.</p>
          </div>
        )}
      </Panel>
    </>
  );
}

/** One-line prompt for the Today tab while reminders are off on this device. */
export function ReminderPrompt() {
  const [on] = useThisDevice();
  const [hidden, setHidden] = useState(() => {
    try {
      return window.localStorage.getItem("medtrack-reminder-prompt") === "hidden";
    } catch {
      return false;
    }
  });
  if (!REMINDERS_AVAILABLE || on !== false || hidden || pushSupport() === "unsupported") return null;
  const hide = () => {
    setHidden(true);
    try {
      window.localStorage.setItem("medtrack-reminder-prompt", "hidden");
    } catch {}
  };
  return (
    <div className="mb-4 flex items-center justify-between gap-3 rounded-lg border border-card-border bg-card px-4 py-3 text-sm" data-testid="banner-reminders">
      <span className="flex items-center gap-2"><BellOff className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> Reminders are off on this device.</span>
      <span className="flex shrink-0 items-center gap-3">
        <a href="#/data" className="font-medium text-primary underline underline-offset-4" data-testid="link-reminders-setup">Set up</a>
        <button type="button" onClick={hide} className="text-muted-foreground underline underline-offset-4" data-testid="button-reminders-dismiss">Hide</button>
      </span>
    </div>
  );
}
