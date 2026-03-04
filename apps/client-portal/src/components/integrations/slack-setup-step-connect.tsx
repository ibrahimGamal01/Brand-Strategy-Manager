"use client";

import { SlackSetupStepState } from "@/types/chat";
import { SlackIntegrationData } from "@/components/integrations/use-slack-integration-data";
import { SlackSetupStepCard } from "@/components/integrations/slack-setup-step-card";

type SlackSetupStepConnectProps = {
  data: SlackIntegrationData;
  state: SlackSetupStepState;
};

export function SlackSetupStepConnect({ data, state }: SlackSetupStepConnectProps) {
  const blockedByPreflight = Boolean(data.preflight && !data.preflight.configured);
  return (
    <SlackSetupStepCard
      number={1}
      title="Prepare + connect Slack"
      detail="Confirm preflight readiness, copy your manifest, and connect your Slack workspace."
      state={state}
    >
      <div className="space-y-3">
        <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Preflight:{" "}
          {data.preflight?.configured
            ? "Ready"
            : `Missing env vars (${data.preflight?.missingEnv.join(", ") || "unknown"}). Fix these first.`}
        </p>
        <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
          OAuth callback: {data.preflight?.callbackUrl || "BACKEND_PUBLIC_ORIGIN not set"}
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void data.connectSlack()}
            disabled={data.connecting || blockedByPreflight}
            className="rounded-full px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70"
            style={{ background: "var(--bat-accent)", color: "white" }}
          >
            {data.connecting
              ? "Redirecting..."
              : blockedByPreflight
                ? "Set env vars first"
                : data.installations.length
                  ? "Reconnect Slack"
                  : "Connect Slack"}
          </button>
          <button
            type="button"
            onClick={() => void data.refreshInstallations(false)}
            className="rounded-full border px-4 py-2 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Refresh status
          </button>
          <button
            type="button"
            onClick={() => void data.copyManifest()}
            className="rounded-full border px-4 py-2 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Copy manifest
          </button>
          <button
            type="button"
            onClick={data.downloadManifest}
            className="rounded-full border px-4 py-2 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Download YAML
          </button>
          <a
            href="https://api.slack.com/apps?new_app=1"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border px-4 py-2 text-sm"
            style={{ borderColor: "var(--bat-border)" }}
          >
            Open Slack App Setup
          </a>
        </div>
        <textarea
          readOnly
          value={data.manifestYaml}
          className="min-h-28 w-full rounded-xl border px-3 py-2 font-mono text-xs"
          style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
        />
      </div>
    </SlackSetupStepCard>
  );
}
