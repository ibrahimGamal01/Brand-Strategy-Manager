import { ChatOsLayout } from "@/components/chat/chat-os-layout";

export default async function WorkspaceChatPage({
  params
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;
  return <ChatOsLayout workspaceId={workspaceId} />;
}
