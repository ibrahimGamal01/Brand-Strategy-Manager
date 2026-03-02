import { WorkspaceSettingsForm } from "./workspace-settings-form";

export default async function WorkspaceSettingsPage({
  params
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  return <WorkspaceSettingsForm workspaceId={workspaceId} />;
}
