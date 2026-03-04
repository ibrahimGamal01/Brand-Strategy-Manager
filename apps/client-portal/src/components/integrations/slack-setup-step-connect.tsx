"use client";

import { SlackSetupStepState } from "@/types/chat";
import { SlackIntegrationData } from "@/components/integrations/use-slack-integration-data";
import { SlackSetupStepCard } from "@/components/integrations/slack-setup-step-card";

type SlackSetupStepConnectProps = {
  data: SlackIntegrationData;
  state: SlackSetupStepState;
};

export function SlackSetupStepConnect({ data, state }: SlackSetupStepConnectProps) {
  const platformReady = data.preflight ? (data.preflight.platformReady ?? data.preflight.configured) : true;
  const blockedByPreflight = Boolean(data.preflight && !platformReady);
  const preflightMessage = platformReady
    ? "Ready"
    : data.isAdminView
      ? `Missing platform config (${data.preflight?.missingEnv?.join(", ") || "unknown"}). Fix these first.`
      : data.preflight?.publicMessage ||
        "BAT Slack is being configured by BAT admins. Contact support and retry.";
  return (
    <SlackSetupStepCard
      number={1}
      title="Prepare + connect Slack"
      detail={
        data.isAdminView
          ? "Confirm platform readiness, manage BAT Slack app manifest, and connect a workspace."
          : "BAT manages one global Slack app. Once platform status is ready, connect your workspace in one click."
      }
      state={state}
    >
      <div className="space-y-3">
        <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
          Preflight: {preflightMessage}
        </p>
        {data.isAdminView ? (
          <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
            OAuth callback: {data.preflight?.callbackUrl || "BACKEND_PUBLIC_ORIGIN not set"}
          </p>
        ) : null}
        {!data.isAdminView ? (
          <p className="text-xs" style={{ color: "var(--bat-text-muted)" }}>
            You do not need to create a Slack app or manage environment variables for your workspace.
          </p>
        ) : null}
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
                ? data.isAdminView
                  ? "Finish platform setup"
                  : "Platform setup pending"
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
          {data.isAdminView ? (
            <>
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
            </>
          ) : null}
        </div>
        {data.isAdminView ? (
          <textarea
            readOnly
            value={data.manifestYaml}
            className="min-h-28 w-full rounded-xl border px-3 py-2 font-mono text-xs"
            style={{ borderColor: "var(--bat-border)", background: "var(--bat-surface-muted)" }}
          />
        ) : null}
      </div>
    </SlackSetupStepCard>
  );
}
