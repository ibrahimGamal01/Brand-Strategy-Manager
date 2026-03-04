import { SlackIntegrationTabs } from "@/components/integrations/slack-integration-tabs";

export default function SlackIntegrationLayout({ children }: { children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <SlackIntegrationTabs />
      {children}
    </section>
  );
}

