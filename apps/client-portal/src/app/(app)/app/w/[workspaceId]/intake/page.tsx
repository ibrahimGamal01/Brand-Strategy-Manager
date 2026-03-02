import { redirect } from "next/navigation";

export default async function WorkspaceIntakeCompatPage({
  params,
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  redirect(`/app/w/${workspaceId}`);
}
