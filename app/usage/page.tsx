import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  Clock3,
  Coins,
  FolderKanban,
  Gauge,
  Hash,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { prisma } from "@/lib/db/client";

const DEV_USER_ID = process.env.DEV_USER_ID ?? "dev-user";

export const dynamic = "force-dynamic";

type ProjectUsage = {
  id: string;
  name: string;
  status: string;
  lastActive: Date;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  totalTokens: number;
  costUsd: number;
};

function numberFormat(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function money(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: value >= 1 ? 2 : 4,
    maximumFractionDigits: value >= 1 ? 2 : 6,
  }).format(value);
}

function dateTime(value: Date) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function sumProjects(projects: ProjectUsage[]) {
  return projects.reduce(
    (acc, project) => ({
      turns: acc.turns + project.turns,
      inputTokens: acc.inputTokens + project.inputTokens,
      outputTokens: acc.outputTokens + project.outputTokens,
      cacheCreationInputTokens:
        acc.cacheCreationInputTokens + project.cacheCreationInputTokens,
      cacheReadInputTokens: acc.cacheReadInputTokens + project.cacheReadInputTokens,
      totalTokens: acc.totalTokens + project.totalTokens,
      costUsd: acc.costUsd + project.costUsd,
    }),
    {
      turns: 0,
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
    },
  );
}

export default async function UsageDashboard() {
  const [projects, recentTurns] = await Promise.all([
    prisma.project.findMany({
      where: { ownerId: DEV_USER_ID },
      orderBy: { lastActive: "desc" },
      select: {
        id: true,
        name: true,
        status: true,
        lastActive: true,
        tokenUsages: {
          where: { label: "TURN" },
          orderBy: { createdAt: "desc" },
          select: {
            inputTokens: true,
            outputTokens: true,
            cacheCreationInputTokens: true,
            cacheReadInputTokens: true,
            totalTokens: true,
            costUsd: true,
          },
        },
      },
    }),
    prisma.tokenUsage.findMany({
      where: {
        label: "TURN",
        project: { ownerId: DEV_USER_ID },
      },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: {
        id: true,
        projectId: true,
        turnId: true,
        inputTokens: true,
        outputTokens: true,
        cacheCreationInputTokens: true,
        cacheReadInputTokens: true,
        totalTokens: true,
        costUsd: true,
        durationMs: true,
        createdAt: true,
        project: { select: { name: true } },
      },
    }),
  ]);

  const projectUsage: ProjectUsage[] = projects.map((project) => {
    const usage = project.tokenUsages.reduce(
      (acc, row) => ({
        inputTokens: acc.inputTokens + row.inputTokens,
        outputTokens: acc.outputTokens + row.outputTokens,
        cacheCreationInputTokens:
          acc.cacheCreationInputTokens + row.cacheCreationInputTokens,
        cacheReadInputTokens: acc.cacheReadInputTokens + row.cacheReadInputTokens,
        totalTokens: acc.totalTokens + row.totalTokens,
        costUsd: acc.costUsd + Number(row.costUsd),
      }),
      {
        inputTokens: 0,
        outputTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        totalTokens: 0,
        costUsd: 0,
      },
    );

    return {
      id: project.id,
      name: project.name,
      status: project.status,
      lastActive: project.lastActive,
      turns: project.tokenUsages.length,
      ...usage,
    };
  });

  const totals = sumProjects(projectUsage);

  return (
    <main className="min-h-dvh bg-background">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit">
              <BarChart3 className="size-3.5" />
              Usage dashboard
            </Badge>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
                Tokens & costs
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
                Per-project token usage from completed agent turns, including cache write/read tokens.
              </p>
            </div>
          </div>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft />
              Projects
            </Link>
          </Button>
        </header>

        <section className="grid gap-3 md:grid-cols-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                <Coins className="size-4 text-primary" />
                Total cost
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{money(totals.costUsd)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                <Gauge className="size-4 text-primary" />
                Total tokens
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {numberFormat(totals.totalTokens)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                <Hash className="size-4 text-primary" />
                Turns
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">{numberFormat(totals.turns)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-sm text-muted-foreground">
                <FolderKanban className="size-4 text-primary" />
                Projects
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-semibold tabular-nums">
                {numberFormat(projectUsage.length)}
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Project usage</h2>
            <p className="text-xs text-muted-foreground">Totals are calculated from aggregate turn rows.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b border-border bg-muted/45 text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Project</th>
                  <th className="px-4 py-3 text-right font-medium">Cost</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 text-right font-medium">Input</th>
                  <th className="px-4 py-3 text-right font-medium">Cache write</th>
                  <th className="px-4 py-3 text-right font-medium">Cache read</th>
                  <th className="px-4 py-3 text-right font-medium">Output</th>
                  <th className="px-4 py-3 text-right font-medium">Turns</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {projectUsage.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground">
                      No projects found.
                    </td>
                  </tr>
                ) : (
                  projectUsage.map((project) => (
                    <tr key={project.id} className="hover:bg-accent/45">
                      <td className="px-4 py-3">
                        <div className="flex min-w-64 items-center gap-3">
                          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
                            <FolderKanban className="size-4 text-primary" />
                          </div>
                          <div className="min-w-0">
                            <Button asChild variant="link" className="max-w-full font-semibold text-foreground">
                              <Link href={`/project/${project.id}`} className="truncate">
                                {project.name}
                              </Link>
                            </Button>
                            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                              <Badge variant="outline">{project.status.toLowerCase()}</Badge>
                              <span>{dateTime(project.lastActive)}</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right font-medium tabular-nums">
                        {money(project.costUsd)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {numberFormat(project.totalTokens)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {numberFormat(project.inputTokens)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {numberFormat(project.cacheCreationInputTokens)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {numberFormat(project.cacheReadInputTokens)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {numberFormat(project.outputTokens)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {numberFormat(project.turns)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Recent turns</h2>
            <p className="text-xs text-muted-foreground">Latest completed aggregate turns across all projects.</p>
          </div>
          {recentTurns.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-3 px-4 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-lg border border-border bg-secondary">
                <Clock3 className="size-5 text-muted-foreground" />
              </div>
              <div>
                <h3 className="font-medium">No usage recorded yet</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Run a new agent turn and the totals will appear here.
                </p>
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {recentTurns.map((turn) => (
                <li
                  key={turn.id}
                  className="grid gap-3 px-4 py-3 md:grid-cols-[1fr_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button asChild variant="link" className="max-w-full font-semibold text-foreground">
                        <Link href={`/project/${turn.projectId}`} className="truncate">
                          {turn.project.name}
                        </Link>
                      </Button>
                      <Badge variant="secondary">{turn.turnId}</Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {dateTime(turn.createdAt)} · {(turn.durationMs / 1000).toFixed(1)}s
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-right text-xs sm:grid-cols-4">
                    <div>
                      <div className="text-muted-foreground">Cost</div>
                      <div className="font-medium tabular-nums">{money(Number(turn.costUsd))}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Total</div>
                      <div className="font-medium tabular-nums">{numberFormat(turn.totalTokens)}</div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Cache</div>
                      <div className="font-medium tabular-nums">
                        {numberFormat(turn.cacheCreationInputTokens + turn.cacheReadInputTokens)}
                      </div>
                    </div>
                    <div>
                      <div className="text-muted-foreground">Output</div>
                      <div className="font-medium tabular-nums">{numberFormat(turn.outputTokens)}</div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
