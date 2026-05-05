"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent, type ReactElement } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LibraryEditor, type EditableLibraryItem } from "@/components/library/LibraryEditor";
import { LibraryList } from "@/components/library/LibraryList";
import { Textarea } from "@/components/ui/textarea";
import {
  configTextForItem,
  defaultContentForType,
  parseConfigText,
  tagsFromInput,
} from "@/lib/library/client-forms";
import type { LibraryItemType } from "@/lib/library/types";

export type LibraryClientItem = EditableLibraryItem;

type LibraryClientProps = {
  items: LibraryClientItem[];
};

type MetadataDraft = {
  name: string;
  description: string;
  tagsText: string;
};

type RevisionDraft = {
  title: string;
  changeNote: string;
  content: string;
  configText: string;
};

type CreateDraft = {
  type: LibraryItemType;
  slug: string;
  name: string;
  description: string;
  tagsText: string;
};

const EMPTY_CREATE_DRAFT: CreateDraft = {
  type: "AGENT",
  slug: "",
  name: "",
  description: "",
  tagsText: "",
};

function metadataDraftForItem(item: LibraryClientItem): MetadataDraft {
  return {
    name: item.name,
    description: item.description,
    tagsText: item.tags.join(", "),
  };
}

function revisionDraftForItem(item: LibraryClientItem): RevisionDraft {
  const nextVersion = (item.currentRevision?.version ?? 0) + 1;
  return {
    title: `${item.name} v${nextVersion}`,
    changeNote: "",
    content: item.currentRevision?.content ?? defaultContentForType(item.type),
    configText: configTextForItem(item.type, item.currentRevision?.configJson ?? null),
  };
}

function isLibraryItemType(value: string): value is LibraryItemType {
  return value === "SKILL" || value === "AGENT" || value === "WORKFLOW_PRESET";
}

async function jsonFetch<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const body = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) {
    throw new Error(body.error ?? `HTTP ${response.status}`);
  }
  return body;
}

export function LibraryClient(props: LibraryClientProps): ReactElement {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(props.items[0]?.id ?? null);
  const [isCreatingNew, setIsCreatingNew] = useState(props.items.length === 0);
  const [createDraft, setCreateDraft] = useState<CreateDraft>(EMPTY_CREATE_DRAFT);
  const [metadataDraft, setMetadataDraft] = useState<MetadataDraft | null>(null);
  const [revisionDraft, setRevisionDraft] = useState<RevisionDraft | null>(null);
  const [savingMetadata, setSavingMetadata] = useState(false);
  const [publishingRevision, setPublishingRevision] = useState(false);
  const [creatingItem, setCreatingItem] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const selectedItem =
    isCreatingNew
      ? null
      : props.items.find((item) => item.id === selectedId) ?? props.items[0] ?? null;

  const selectedItemKey = selectedItem
    ? `${selectedItem.id}:${selectedItem.currentRevision?.id ?? "draft"}`
    : "none";

  useEffect(() => {
    if (!selectedItem) return;
    queueMicrotask(() => {
      setMetadataDraft(metadataDraftForItem(selectedItem));
      setRevisionDraft(revisionDraftForItem(selectedItem));
      setMessage(null);
      setError(null);
    });
  }, [selectedItemKey, selectedItem]);

  const itemCountLabel = useMemo(() => `${props.items.length} items`, [props.items.length]);

  function selectItem(id: string): void {
    setIsCreatingNew(false);
    setSelectedId(id);
    setMessage(null);
    setError(null);
  }

  function selectNewItem(): void {
    setIsCreatingNew(true);
    setSelectedId(null);
    setCreateDraft(EMPTY_CREATE_DRAFT);
    setMessage(null);
    setError(null);
  }

  async function createItem(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreatingItem(true);
    setError(null);
    setMessage(null);
    try {
      const body = await jsonFetch<{ item: { id: string } }>("/api/library", {
        method: "POST",
        body: JSON.stringify({
          type: createDraft.type,
          slug: createDraft.slug,
          name: createDraft.name,
          description: createDraft.description,
          tags: tagsFromInput(createDraft.tagsText),
        }),
      });
      setSelectedId(body.item.id);
      setIsCreatingNew(false);
      setCreateDraft(EMPTY_CREATE_DRAFT);
      setMessage("Library item created.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create item");
    } finally {
      setCreatingItem(false);
    }
  }

  async function saveMetadata(): Promise<void> {
    if (!selectedItem || !metadataDraft) return;
    setSavingMetadata(true);
    setError(null);
    setMessage(null);
    try {
      await jsonFetch(`/api/library/${selectedItem.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: metadataDraft.name,
          description: metadataDraft.description,
          tags: tagsFromInput(metadataDraft.tagsText),
        }),
      });
      setMessage("Metadata saved.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save metadata");
    } finally {
      setSavingMetadata(false);
    }
  }

  async function publishRevision(): Promise<void> {
    if (!selectedItem || !revisionDraft) return;
    setPublishingRevision(true);
    setError(null);
    setMessage(null);
    try {
      const configJson = parseConfigText(revisionDraft.configText);
      await jsonFetch(`/api/library/${selectedItem.id}/revisions`, {
        method: "POST",
        body: JSON.stringify({
          title: revisionDraft.title,
          content: revisionDraft.content,
          configJson,
          changeNote: revisionDraft.changeNote,
        }),
      });
      setMessage("Revision published.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish revision");
    } finally {
      setPublishingRevision(false);
    }
  }

  async function archiveItem(): Promise<void> {
    if (!selectedItem) return;
    setArchiving(true);
    setError(null);
    setMessage(null);
    try {
      await jsonFetch(`/api/library/${selectedItem.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "ARCHIVED" }),
      });
      setMessage("Item archived.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not archive item");
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="grid min-h-[calc(100dvh-120px)] gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
      <LibraryList
        items={props.items}
        selectedId={selectedItem?.id ?? null}
        onSelect={selectItem}
        onNew={selectNewItem}
      />

      <section className="min-w-0 rounded-md border border-border bg-card p-4">
        {isCreatingNew ? (
          <form onSubmit={createItem} className="flex min-h-full flex-col gap-4">
            <div className="border-b border-border pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold text-foreground">New library item</h1>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Create an item shell, then publish its first immutable revision.
                  </p>
                </div>
                <Badge variant="outline">{itemCountLabel}</Badge>
              </div>
            </div>

            <div className="grid gap-3 rounded-md border border-border bg-background p-4 md:grid-cols-2">
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Type</span>
                <select
                  value={createDraft.type}
                  onChange={(event) => {
                    const type = isLibraryItemType(event.target.value) ? event.target.value : "AGENT";
                    setCreateDraft((current) => ({ ...current, type }));
                  }}
                  className="flex h-11 w-full rounded-md border border-input bg-background/80 px-3 py-2 text-sm text-foreground shadow-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/35"
                >
                  <option value="AGENT">Agent</option>
                  <option value="SKILL">Skill</option>
                  <option value="WORKFLOW_PRESET">Workflow preset</option>
                </select>
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Slug</span>
                <Input
                  value={createDraft.slug}
                  onChange={(event) => setCreateDraft((current) => ({ ...current, slug: event.target.value }))}
                  placeholder="reviewer"
                  required
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Name</span>
                <Input
                  value={createDraft.name}
                  onChange={(event) => setCreateDraft((current) => ({ ...current, name: event.target.value }))}
                  placeholder="Reviewer"
                  required
                />
              </label>
              <label className="space-y-1.5">
                <span className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Tags</span>
                <Input
                  value={createDraft.tagsText}
                  onChange={(event) => setCreateDraft((current) => ({ ...current, tagsText: event.target.value }))}
                  placeholder="review, openhands"
                />
              </label>
              <label className="space-y-1.5 md:col-span-2">
                <span className="text-xs font-medium uppercase tracking-normal text-muted-foreground">Description</span>
                <Textarea
                  value={createDraft.description}
                  onChange={(event) =>
                    setCreateDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  className="min-h-24 resize-y"
                />
              </label>
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsCreatingNew(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={creatingItem}>
                {creatingItem ? "Creating" : "Create item"}
              </Button>
            </div>
          </form>
        ) : selectedItem && metadataDraft && revisionDraft ? (
          <div className="flex min-h-full flex-col gap-4">
            <div className="border-b border-border pb-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="text-xl font-semibold text-foreground">Global OpenHands Library</h1>
                  <p className="mt-1 max-w-3xl text-sm leading-6 text-muted-foreground">
                    Create agents, edit metadata, and publish versioned revisions.
                  </p>
                </div>
                <Badge variant="outline">{itemCountLabel}</Badge>
              </div>
            </div>

            <LibraryEditor
              item={selectedItem}
              metadata={metadataDraft}
              revision={revisionDraft}
              savingMetadata={savingMetadata}
              publishingRevision={publishingRevision}
              archiving={archiving}
              message={message}
              error={error}
              onMetadataChange={setMetadataDraft}
              onRevisionChange={setRevisionDraft}
              onSaveMetadata={saveMetadata}
              onPublishRevision={publishRevision}
              onArchive={archiveItem}
            />
          </div>
        ) : (
          <div className="flex min-h-80 items-center justify-center rounded-md border border-dashed border-border p-6 text-center">
            <div>
              <h1 className="text-xl font-semibold text-foreground">Global OpenHands Library</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
                No library items exist yet. Use the new item control to start an agent, skill, or preset.
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
