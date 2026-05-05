import type { ReactElement } from "react";
import { redirect } from "next/navigation";

import { LibraryClient, type LibraryClientItem } from "@/components/library/LibraryClient";
import { currentUserFromServerHeaders } from "@/lib/auth/current-user";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

export default async function LibraryPage(): Promise<ReactElement> {
  const currentUser = await currentUserFromServerHeaders();
  if (!currentUser) {
    redirect("/sign-in");
  }

  const items = await prisma.libraryItem.findMany({
    where: { userId: currentUser.id },
    orderBy: [{ type: "asc" }, { slug: "asc" }],
    select: {
      id: true,
      type: true,
      slug: true,
      name: true,
      description: true,
      tags: true,
      status: true,
      currentRevision: {
        select: {
          id: true,
          version: true,
          title: true,
          content: true,
          configJson: true,
        },
      },
      revisions: {
        orderBy: { version: "desc" },
        take: 8,
        select: {
          id: true,
          version: true,
          title: true,
          changeNote: true,
          createdAt: true,
        },
      },
    },
  });

  const serializedItems: LibraryClientItem[] = items.map((item) => ({
    id: item.id,
    type: item.type,
    slug: item.slug,
    name: item.name,
    description: item.description,
    tags: item.tags,
    status: item.status,
    currentRevision: item.currentRevision
      ? {
          id: item.currentRevision.id,
          version: item.currentRevision.version,
          title: item.currentRevision.title,
          content: item.currentRevision.content,
          configJson: item.currentRevision.configJson,
        }
      : null,
    revisions: item.revisions.map((revision) => ({
      id: revision.id,
      version: revision.version,
      title: revision.title,
      changeNote: revision.changeNote,
      createdAt: revision.createdAt.toISOString(),
    })),
  }));

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <LibraryClient items={serializedItems} />
      </div>
    </main>
  );
}
