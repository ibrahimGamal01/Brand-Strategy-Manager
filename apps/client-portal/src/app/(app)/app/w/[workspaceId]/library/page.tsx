import { WorkspaceLibraryClient } from "./workspace-library-client";

export default async function WorkspaceLibraryPage({
  params
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <WorkspaceLibraryClient workspaceId={workspaceId} />;
}
