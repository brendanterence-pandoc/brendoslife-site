import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { HEALTH_LABELS, healthLabel } from "@shared/analytics";
import { addDays, fmtDay } from "@shared/schedule";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { exportUrl, nowStamp, todayStr, useAppState, useWrite } from "@/lib/api";
import { API_BASE, AUTH_ENABLED, SIGNED_OUT_EVENT } from "@/lib/queryClient";

async function signOut(kind: "logout" | "logout-all") {
  try {
    await fetch(`${API_BASE}/api/auth/${kind}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
  } finally {
    window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
  }
}
import { ErrorNote, Field, fieldCls, Panel, SectionTitle } from "@/components/bits";
import Reminders from "@/components/Reminders";

const ASKS = [
  "Add a new medication at 8 AM and 8 PM starting tomorrow",
  "Stop a medication because the course is finished",
  "Move an evening dose to 9 PM",
  "Add a sleep quality tracker, 0 to 10, every morning",
  "Sync my Apple Health data",
  "Change my second reminder to 15 minutes",
  "Build a 30-day report for my next appointment",
];

export default function Data() {
  const state = useAppState();
  const { toast } = useToast();
  const today = todayStr();
  const now = nowStamp();
  const csvRef = useRef<HTMLInputElement>(null);
  const bakRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<any>(null);
  const [name, setName] = useState<string | null>(null);
  const [dob, setDob] = useState<string | null>(null);
  const importCsv = useWrite<{ csv: string }, { rows: number; added: number; updated: number; itemsCreated: number }>("POST", "/api/import/medisafe");
  const restore = useWrite<{ backup: any; replace: boolean }>("POST", "/api/import/backup");
  const putMeta = useWrite<{ key: string; value: string }>("PUT", (b) => `/api/meta/${b.key}`);
  const fail = (e: unknown) => toast({ title: "That did not work", description: e instanceof Error ? e.message : "Please try again.", variant: "destructive" });

  if (state.isError) return <ErrorNote error={state.error} onRetry={() => state.refetch()} />;
  if (!state.data)
    return (
      <div className="mx-auto max-w-2xl space-y-3" aria-busy="true">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  const { meta, healthSummary, firstDate } = state.data;
  const all = { from: firstDate ?? today, to: today, now };
  const last30 = { from: addDays(today, -29), to: today, now };
  const vName = name ?? meta.patient_name ?? "";
  const vDob = dob ?? meta.patient_dob ?? "";

  const onCsv = async (file?: File) => {
    if (!file) return;
    try {
      const csv = await file.text();
      importCsv.mutate({ csv }, {
        onSuccess: (r) => toast({ title: "Medisafe history added", description: `${r.added} new ${r.added === 1 ? "entry" : "entries"}, ${r.updated} updated${r.itemsCreated ? `, ${r.itemsCreated} past ${r.itemsCreated === 1 ? "item" : "items"} added to the regimen history` : ""}.` }),
        onError: fail,
      });
    } catch (e) {
      fail(e);
    } finally {
      if (csvRef.current) csvRef.current.value = "";
    }
  };
  const onBackup = async (file?: File) => {
    if (!file) return;
    try {
      setPending(JSON.parse(await file.text()));
    } catch {
      fail(new Error("That file is not a MedTrack backup."));
    } finally {
      if (bakRef.current) bakRef.current.value = "";
    }
  };

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-xl font-semibold tracking-tight">Data</h1>
      <p className="text-sm text-muted-foreground" data-testid="text-data-summary">
        {firstDate ? `Entries stored from ${fmtDay(firstDate, { year: true })} to today.` : "No entries stored yet."}
      </p>

      <Reminders />

      <SectionTitle>Make changes by asking</SectionTitle>
      <Panel className="p-4">
        <p className="text-sm text-muted-foreground">Tell the assistant in plain words and the change shows up here. Examples:</p>
        <ul className="mt-2 space-y-1.5 text-sm">
          {ASKS.map((a) => <li key={a} className="border-l-2 border-gold pl-3">{a}</li>)}
        </ul>
      </Panel>

      <SectionTitle>Reports and exports</SectionTitle>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button asChild className="min-h-12" data-testid="link-report-30">
          <a href={exportUrl("report.html", { ...last30, inline: "1" })} target="_blank" rel="noopener noreferrer">Open 30-day clinician report</a>
        </Button>
        <Button asChild variant="outline" className="min-h-12 bg-card" data-testid="link-daily-all">
          <a href={exportUrl("daily.csv", all)} target="_blank" rel="noopener noreferrer"><Download /> Daily table, all time (CSV)</a>
        </Button>
        <Button asChild variant="outline" className="min-h-12 bg-card" data-testid="link-history-all">
          <a href={exportUrl("medisafe.csv", all)} target="_blank" rel="noopener noreferrer"><Download /> Every entry, all time (CSV)</a>
        </Button>
        <Button asChild variant="outline" className="min-h-12 bg-card" data-testid="link-backup">
          <a href={exportUrl("backup.json", { now })} target="_blank" rel="noopener noreferrer"><Download /> Full backup (JSON)</a>
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">The entry export uses the same columns as a Medisafe export, so earlier analysis tools keep working. For other date ranges use the Trends tab.</p>

      <SectionTitle>Report header</SectionTitle>
      <Panel className="space-y-3 p-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Name"><input value={vName} onChange={(e) => setName(e.target.value)} maxLength={80} className={fieldCls} data-testid="input-patient-name" /></Field>
          <Field label="Date of birth"><input value={vDob} onChange={(e) => setDob(e.target.value)} maxLength={20} placeholder="MM/DD/YYYY" className={fieldCls} data-testid="input-patient-dob" /></Field>
        </div>
        <Button variant="outline" className="min-h-11" disabled={putMeta.isPending || (name == null && dob == null)} data-testid="button-save-header"
          onClick={async () => {
            try {
              await putMeta.mutateAsync({ key: "patient_name", value: vName.trim() });
              await putMeta.mutateAsync({ key: "patient_dob", value: vDob.trim() });
              setName(null); setDob(null);
              toast({ title: "Saved" });
            } catch (e) { fail(e); }
          }}>
          Save
        </Button>
      </Panel>

      <SectionTitle>Medisafe history</SectionTitle>
      <Panel className="p-4">
        <p className="text-sm text-muted-foreground">
          In Medisafe open Manage, then Report, and export as CSV. Choose the file here to add it to your history. Importing the same file twice does not create duplicates.
        </p>
        <input ref={csvRef} type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => onCsv(e.target.files?.[0])} data-testid="input-csv" aria-label="Medisafe CSV file" />
        <Button variant="outline" className="mt-3 min-h-12" disabled={importCsv.isPending} onClick={() => csvRef.current?.click()} data-testid="button-import-csv">
          <Upload /> {importCsv.isPending ? "Importing" : "Choose Medisafe CSV"}
        </Button>
      </Panel>

      <SectionTitle>Apple Health</SectionTitle>
      <Panel className="p-4">
        {healthSummary.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing synced yet. Ask the assistant to sync Apple Health. Daily sleep, steps, heart rate and other metrics are stored here and lined up with your scores on the Trends tab.</p>
        ) : (
          <>
            <p className="text-sm text-muted-foreground" data-testid="text-health-sync">
              Last synced {meta.health_synced_at ? fmtDay(meta.health_synced_at.slice(0, 10), { year: true }) : "at an unknown time"}. Ask the assistant to sync again for newer days.
            </p>
            <table className="mt-3 w-full text-sm">
              <thead><tr className="border-b text-left text-xs text-muted-foreground"><th className="py-1.5 font-medium">Metric</th><th className="py-1.5 text-right font-medium">Days</th><th className="py-1.5 text-right font-medium">Range</th></tr></thead>
              <tbody className="divide-y">
                {healthSummary.map((h) => (
                  <tr key={h.metric}><td className="py-1.5">{healthLabel(h.metric)}{HEALTH_LABELS[h.metric]?.unit ? <span className="text-muted-foreground"> ({HEALTH_LABELS[h.metric].unit})</span> : null}</td><td className="py-1.5 text-right tabular-nums">{h.days}</td><td className="py-1.5 text-right tabular-nums text-muted-foreground">{fmtDay(h.first)} to {fmtDay(h.last, { year: true })}</td></tr>
                ))}
              </tbody>
            </table>
          </>
        )}
      </Panel>

      <SectionTitle>Restore from backup</SectionTitle>
      <Panel className="p-4">
        <p className="text-sm text-muted-foreground">Replaces everything in this tracker with the contents of a MedTrack backup file.</p>
        <input ref={bakRef} type="file" accept=".json,application/json" className="sr-only" onChange={(e) => onBackup(e.target.files?.[0])} data-testid="input-backup" aria-label="Backup file" />
        {!pending ? (
          <Button variant="outline" className="mt-3 min-h-12" onClick={() => bakRef.current?.click()} data-testid="button-choose-backup"><Upload /> Choose backup file</Button>
        ) : (
          <div className="mt-3 rounded-md border border-destructive/40 p-3">
            <p className="text-sm">
              This backup has {pending.items?.length ?? 0} regimen items and {pending.logs?.length ?? 0} entries{pending.exportedAt ? `, saved ${fmtDay(String(pending.exportedAt).slice(0, 10), { year: true })}` : ""}. Restoring replaces all current data.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              <Button variant="destructive" className="min-h-12" disabled={restore.isPending} data-testid="button-restore-confirm"
                onClick={() => restore.mutate({ backup: pending, replace: true }, { onSuccess: () => { setPending(null); toast({ title: "Backup restored" }); }, onError: fail })}>
                Replace my data
              </Button>
              <Button variant="outline" className="min-h-12" onClick={() => setPending(null)} data-testid="button-restore-cancel">Cancel</Button>
            </div>
          </div>
        )}
      </Panel>

      {AUTH_ENABLED && (
        <>
          <SectionTitle>This device</SectionTitle>
          <Panel className="p-4">
            <p className="text-sm text-muted-foreground">This device stays signed in. Sign out if someone else uses it, or sign out everywhere if a phone or computer is lost.</p>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              <Button variant="outline" className="min-h-12" onClick={() => signOut("logout")} data-testid="button-sign-out">Sign out</Button>
              <Button variant="outline" className="min-h-12" onClick={() => signOut("logout-all")} data-testid="button-sign-out-all">Sign out everywhere</Button>
            </div>
          </Panel>
        </>
      )}
    </div>
  );
}
