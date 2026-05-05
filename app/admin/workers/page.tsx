import type { ReactElement } from "react";
import { notFound, redirect } from "next/navigation";

import { Badge } from "@/components/ui/badge";
import { currentUserFromServerHeaders, isAdminUser } from "@/lib/auth/current-user";
import { WorkersClient } from "./WorkersClient";

export default async function WorkersAdminPage(): Promise<ReactElement> {
  const currentUser = await currentUserFromServerHeaders();
  if (!currentUser) {
    redirect("/sign-in");
  }
  if (!isAdminUser(currentUser)) {
    notFound();
  }

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit">
              Worker pool
            </Badge>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                Workers
              </h1>
              <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                Provision, drain, retry, and decommission managed worker capacity.
              </p>
            </div>
          </div>
        </header>

        <WorkersClient />
      </div>
    </main>
  );
}
