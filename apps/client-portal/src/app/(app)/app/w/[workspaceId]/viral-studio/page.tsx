import { ViralBrandStudioShell } from "@/components/viral-studio/viral-brand-studio-shell";

export default async function WorkspaceViralStudioPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <ViralBrandStudioShell workspaceId={workspaceId} />;
}
