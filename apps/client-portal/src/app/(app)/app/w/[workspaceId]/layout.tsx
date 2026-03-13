import { WorkspaceProcessQuestionModalHost } from "@/components/process/workspace-process-question-modal-host";

export default async function WorkspaceScopedLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return (
    <>
      {children}
      <WorkspaceProcessQuestionModalHost workspaceId={workspaceId} />
    </>
  );
}
