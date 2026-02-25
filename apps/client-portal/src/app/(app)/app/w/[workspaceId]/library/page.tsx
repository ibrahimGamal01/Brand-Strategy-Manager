import Link from "next/link";

export default async function WorkspaceLibraryPage({
  params
}: {
  params: Promise<{ workspaceId: string }>;
}) {
  const { workspaceId } = await params;

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Library • {workspaceId}</h1>
      <p className="text-sm" style={{ color: "var(--bat-text-muted)" }}>
        The full library usually opens as a drawer in chat. This page exists as an optional standalone view.
      </p>
      <Link href={`/app/w/${workspaceId}`} className="rounded-full border px-4 py-2 text-sm" style={{ borderColor: "var(--bat-border)" }}>
        Return to chat workspace
      </Link>
    </section>
  );
}
