"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

type PrimaryKpi = "Lead quality" | "Revenue" | "Audience growth";
type MainChannelFocus = "Mixed" | "Web" | "Social";

function toBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function WorkspaceSettingsForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter();
  const [primaryKpi, setPrimaryKpi] = useState<PrimaryKpi>("Lead quality");
  const [mainChannelFocus, setMainChannelFocus] = useState<MainChannelFocus>("Mixed");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError(null);

    try {
      const storageKey = `bat.runtime.preferences.${workspaceId}`;
      const raw = window.localStorage.getItem(storageKey);
      let existing: Record<string, unknown> = {};
      if (raw) {
        try {
          const parsed = JSON.parse(raw) as unknown;
          if (isRecord(parsed)) existing = parsed;
        } catch {
          existing = {};
        }
      }

      const sourceScope = isRecord(existing.sourceScope) ? existing.sourceScope : {};
      const nextSourceScope = {
        workspaceData: toBoolean(sourceScope.workspaceData, true),
        libraryPinned: toBoolean(sourceScope.libraryPinned, true),
        uploadedDocs: toBoolean(sourceScope.uploadedDocs, true),
        webSearch: toBoolean(sourceScope.webSearch, true),
        liveWebsiteCrawl: toBoolean(sourceScope.liveWebsiteCrawl, true),
        socialIntel: toBoolean(sourceScope.socialIntel, true),
        slackIntel: toBoolean(sourceScope.slackIntel, true),
      };

      if (mainChannelFocus === "Web") {
        nextSourceScope.webSearch = true;
        nextSourceScope.liveWebsiteCrawl = true;
        nextSourceScope.socialIntel = false;
        nextSourceScope.slackIntel = true;
      } else if (mainChannelFocus === "Social") {
        nextSourceScope.webSearch = false;
        nextSourceScope.liveWebsiteCrawl = false;
        nextSourceScope.socialIntel = true;
        nextSourceScope.slackIntel = true;
      } else {
        nextSourceScope.webSearch = true;
        nextSourceScope.liveWebsiteCrawl = true;
        nextSourceScope.socialIntel = true;
        nextSourceScope.slackIntel = true;
      }

      window.localStorage.setItem(
        storageKey,
        JSON.stringify({
          ...existing,
          sourceScope: nextSourceScope,
          strategyControls: {
            primaryKpi,
            mainChannelFocus,
            updatedAt: new Date().toISOString(),
          },
        })
      );

      router.push(`/app/w/${workspaceId}`);
      router.refresh();
    } catch (saveError: unknown) {
      setError(String((saveError as Error)?.message || "Failed to save settings"));
      setSaving(false);
    }
  };

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border p-5 md:p-6" style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}>
        <p className="bat-chip">Workspace Settings</p>
        <h1 className="mt-3 text-2xl font-semibold md:text-3xl">Configure Strategy Controls</h1>
        <p className="mt-2 max-w-3xl text-sm md:text-base" style={{ color: "var(--bat-text-muted)" }}>
          Update priorities that influence tool planning, evidence ranking, and output style.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href={`/app/w/${workspaceId}`}
            className="rounded-full px-4 py-2 text-sm font-semibold"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            Back to Chat
          </Link>
          <Link href={`/app/w/${workspaceId}/library`} className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--bat-border)" }}>
            Open Library
          </Link>
        </div>
      </div>

      <form onSubmit={onSubmit} className="bat-surface p-5">
        <div className="grid gap-4 md:grid-cols-2">
          <label className="text-sm">
            Primary KPI
            <select
              value={primaryKpi}
              onChange={(event) => setPrimaryKpi(event.target.value as PrimaryKpi)}
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
            >
              <option>Lead quality</option>
              <option>Revenue</option>
              <option>Audience growth</option>
            </select>
          </label>
          <label className="text-sm">
            Main channel focus
            <select
              value={mainChannelFocus}
              onChange={(event) => setMainChannelFocus(event.target.value as MainChannelFocus)}
              className="mt-1 w-full rounded-xl border px-3 py-2"
              style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface)" }}
            >
              <option>Mixed</option>
              <option>Web</option>
              <option>Social</option>
            </select>
          </label>
        </div>
        {error ? (
          <p className="mt-3 rounded-xl border border-[#f5b8b3] bg-[#fff5f4] px-3 py-2 text-sm text-[#8a1f17]">{error}</p>
        ) : null}
        <button
          type="submit"
          disabled={saving}
          className="mt-5 rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
          style={{ background: "var(--bat-accent)", color: "white" }}
        >
          {saving ? "Saving..." : "Save and Continue in Chat"}
        </button>
      </form>
    </section>
  );
}
