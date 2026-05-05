"use client";

import { useMemo, useState, type ReactElement } from "react";
import { FileText, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { LibraryItemStatus, LibraryItemType } from "@/lib/library/types";
import { cn } from "@/lib/utils";

export type LibraryListItem = {
  id: string;
  type: LibraryItemType;
  slug: string;
  name: string;
  description: string;
  tags: string[];
  status: LibraryItemStatus;
};

type LibraryListProps = {
  items: LibraryListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onNew?: () => void;
};

function itemTypeLabel(type: LibraryItemType): string {
  if (type === "WORKFLOW_PRESET") return "Preset";
  return type.toLowerCase();
}

function statusVariant(status: LibraryItemStatus): "outline" | "secondary" | "success" {
  if (status === "PUBLISHED") return "success";
  if (status === "ARCHIVED") return "outline";
  return "secondary";
}

export function LibraryList(props: LibraryListProps): ReactElement {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return props.items;

    return props.items.filter((item) =>
      [item.name, item.slug, item.description, item.type, item.status, ...item.tags]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery),
    );
  }, [props.items, query]);

  return (
    <section className="flex min-h-0 flex-col gap-3">
      <div className="flex items-center gap-2">
        <label className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search library items"
            placeholder="Search library"
            className="h-10 pl-9"
          />
        </label>
        <Button
          type="button"
          size="icon"
          onClick={props.onNew}
          title="New item"
          aria-label="New library item"
        >
          <Plus />
        </Button>
      </div>

      <div className="min-h-0 overflow-hidden rounded-md border border-border bg-card">
        <div className="max-h-[calc(100dvh-220px)] divide-y divide-border overflow-auto">
          {filtered.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => props.onSelect(item.id)}
              aria-pressed={props.selectedId === item.id}
              className={cn(
                "block w-full px-3 py-3 text-left outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring",
                props.selectedId === item.id && "bg-muted",
              )}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText className="size-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm font-medium text-foreground">
                      {item.name}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{item.slug}</p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <Badge variant={props.selectedId === item.id ? "default" : "secondary"}>
                    {itemTypeLabel(item.type)}
                  </Badge>
                  <Badge variant={statusVariant(item.status)}>{item.status.toLowerCase()}</Badge>
                </div>
              </div>
              <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted-foreground">
                {item.description || "No description"}
              </p>
              {item.tags.length > 0 ? (
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.tags.slice(0, 3).map((tag) => (
                    <Badge key={tag} variant="outline">
                      {tag}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </button>
          ))}

          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-sm text-muted-foreground">No library items found.</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
