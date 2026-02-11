import { redirect } from 'next/navigation';

export default async function LegacyResearchJobPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/research/${id}`);
}
