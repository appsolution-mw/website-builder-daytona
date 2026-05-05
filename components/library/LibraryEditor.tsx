"use client";

import { Archive, Save, UploadCloud } from "lucide-react";
import type { FormEvent, ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { LibraryItemStatus, LibraryItemType } from "@/lib/library/types";
import { cn } from "@/lib/utils";

export type EditableLibraryItem = {
  id: string;
  type: LibraryItemType;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  status: LibraryItemStatus;
  currentRevision: {
    id: string;
    version: number;
    title: string;
    content: string;
    configJson: unknown;
  } | null;
  revisions: Array<{
    id: string;
    version: number;
    title: string;
    changeNote: string;
    createdAt: string;
  }>;
};

type LibraryEditorProps = {
  item: EditableLibraryItem;
  metadata: {
    name: string;
    description: string;
    tagsText: string;
  };
  revision: {
    title: string;
    changeNote: string;
    content: string;
    configText: string;
  };
  savingMetadata: boolean;
  publishingRevision: boolean;
  archiving: boolean;
  message: string | null;
  error: string | null;
  onMetadataChange: (metadata: LibraryEditorProps["metadata"]) => void;
  onRevisionChange: (revision: LibraryEditorProps["revision"]) => void;
  onSaveMetadata: () => void;
  onPublishRevision: () => void;
  onArchive: () => void;
};

function itemTypeLabel(type: LibraryItemType): string {
  if (type === "WORKFLOW_PRESET") return "Workflow preset";
  return type.toLowerCase();
}

function revisionConfigLabel(type: LibraryItemType): string {
  if (type === "AGENT") return "Agent configuration";
  if (type === "WORKFLOW_PRESET") return "Preset configuration";
  return "Skill configuration";
}

function FieldLabel({
  children,
  htmlFor,
}: {
  children: React.ReactNode;
  htmlFor: string;
}): ReactElement {
  return (
    <label htmlFor={htmlFor} className="text-xs font-medium uppercase tracking-normal text-muted-foreground">
      {children}
    </label>
  );
}

export function LibraryEditor(props: LibraryEditorProps): ReactElement {
  const item = props.item;

  function submitMetadata(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    props.onSaveMetadata();
  }

  function submitRevision(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    props.onPublishRevision();
  }

  return (
    <div className="grid min-h-0 gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section className="min-w-0 space-y-4">
        <form onSubmit={submitMetadata} className="rounded-md border border-border bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="secondary">{itemTypeLabel(item.type)}</Badge>
                <Badge variant="outline">{item.status.toLowerCase()}</Badge>
                {item.currentRevision ? (
                  <Badge variant="success">v{item.currentRevision.version}</Badge>
                ) : (
                  <Badge variant="warning">no revision</Badge>
                )}
              </div>
              <h2 className="mt-2 truncate text-lg font-semibold text-foreground">{item.name}</h2>
              <p className="mt-1 truncate text-sm text-muted-foreground">{item.slug}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={props.savingMetadata}>
                <Save />
                {props.savingMetadata ? "Saving" : "Save"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={props.archiving || item.status === "ARCHIVED"}
                onClick={props.onArchive}
              >
                <Archive />
                Archive
              </Button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="library-name">Name</FieldLabel>
              <Input
                id="library-name"
                value={props.metadata.name}
                onChange={(event) =>
                  props.onMetadataChange({ ...props.metadata, name: event.target.value })
                }
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="library-tags">Tags</FieldLabel>
              <Input
                id="library-tags"
                value={props.metadata.tagsText}
                onChange={(event) =>
                  props.onMetadataChange({ ...props.metadata, tagsText: event.target.value })
                }
                placeholder="review, openhands"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor="library-description">Description</FieldLabel>
              <Textarea
                id="library-description"
                value={props.metadata.description}
                onChange={(event) =>
                  props.onMetadataChange({ ...props.metadata, description: event.target.value })
                }
                className="min-h-20 resize-y"
              />
            </div>
          </div>
        </form>

        <form onSubmit={submitRevision} className="rounded-md border border-border bg-background p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-base font-semibold text-foreground">Publish revision</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Edits create an immutable revision and make it current for new sessions.
              </p>
            </div>
            <Button type="submit" disabled={props.publishingRevision || item.status === "ARCHIVED"}>
              <UploadCloud />
              {props.publishingRevision ? "Publishing" : "Publish"}
            </Button>
          </div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="space-y-1.5">
              <FieldLabel htmlFor="revision-title">Revision title</FieldLabel>
              <Input
                id="revision-title"
                value={props.revision.title}
                onChange={(event) =>
                  props.onRevisionChange({ ...props.revision, title: event.target.value })
                }
                placeholder="Reviewer v2"
              />
            </div>
            <div className="space-y-1.5">
              <FieldLabel htmlFor="revision-note">Change note</FieldLabel>
              <Input
                id="revision-note"
                value={props.revision.changeNote}
                onChange={(event) =>
                  props.onRevisionChange({ ...props.revision, changeNote: event.target.value })
                }
                placeholder="Tighten review criteria"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor="revision-content">Content</FieldLabel>
              <Textarea
                id="revision-content"
                value={props.revision.content}
                onChange={(event) =>
                  props.onRevisionChange({ ...props.revision, content: event.target.value })
                }
                spellCheck={false}
                className="min-h-[220px] resize-y font-mono text-sm leading-6"
              />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <FieldLabel htmlFor="revision-config">{revisionConfigLabel(item.type)}</FieldLabel>
              <Textarea
                id="revision-config"
                value={props.revision.configText}
                onChange={(event) =>
                  props.onRevisionChange({ ...props.revision, configText: event.target.value })
                }
                spellCheck={false}
                className={cn("min-h-[190px] resize-y font-mono text-sm leading-6")}
              />
            </div>
          </div>
        </form>

        {props.error ? (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {props.error}
          </p>
        ) : null}
        {props.message ? (
          <p className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">
            {props.message}
          </p>
        ) : null}
      </section>

      <aside className="rounded-md border border-border bg-background p-4">
        <h3 className="text-sm font-semibold text-foreground">Recent revisions</h3>
        <div className="mt-3 space-y-2">
          {item.revisions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No revisions yet.</p>
          ) : (
            item.revisions.map((revision) => (
              <div key={revision.id} className="rounded-md border border-border p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-foreground">v{revision.version}</span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(revision.createdAt).toLocaleDateString()}
                  </span>
                </div>
                <p className="mt-1 text-sm text-foreground">{revision.title}</p>
                {revision.changeNote ? (
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">{revision.changeNote}</p>
                ) : null}
              </div>
            ))
          )}
        </div>
      </aside>
    </div>
  );
}
