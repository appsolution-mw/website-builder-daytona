"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, FileText, Folder, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { buildTreeFromPaths, type TreeNode } from "@/lib/tree/build-tree";
import { cn } from "@/lib/utils";

export interface FileTreeProps {
  paths: string[];
  loading: boolean;
  error: string | null;
  selectedPath: string | null;
  recentlyChanged: Set<string>;
  onSelect: (path: string) => void;
  onRetry: () => void;
}

export function FileTree(props: FileTreeProps) {
  const tree = buildTreeFromPaths(props.paths);
  if (props.error) {
    return (
      <div className="flex flex-col gap-3 p-3 text-sm text-red-200">
        <span>{props.error}</span>
        <Button
          type="button"
          onClick={props.onRetry}
          variant="outline"
          size="sm"
          className="w-fit border-destructive/30 text-red-200 hover:bg-destructive/10 hover:text-red-100"
        >
          <RefreshCw />
          Retry
        </Button>
      </div>
    );
  }
  if (tree.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        {props.loading ? "Loading files..." : "No files found."}
      </div>
    );
  }
  return (
    <ul className="flex flex-col gap-0.5 p-2 text-sm">
      {tree.map((node) => (
        <TreeNodeView
          key={node.path}
          node={node}
          depth={0}
          selectedPath={props.selectedPath}
          recentlyChanged={props.recentlyChanged}
          onSelect={props.onSelect}
        />
      ))}
    </ul>
  );
}

interface NodeViewProps {
  node: TreeNode;
  depth: number;
  selectedPath: string | null;
  recentlyChanged: Set<string>;
  onSelect: (path: string) => void;
}

function TreeNodeView({ node, depth, selectedPath, recentlyChanged, onSelect }: NodeViewProps) {
  const [open, setOpen] = useState(depth < 1);
  if (node.kind === "dir") {
    return (
      <li>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="flex h-8 w-full cursor-pointer items-center gap-1 rounded-md px-2 text-left text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/35"
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          {open ? <ChevronDown className="size-3.5 shrink-0" /> : <ChevronRight className="size-3.5 shrink-0" />}
          <Folder className="size-3.5 shrink-0" />
          <span className="truncate">{node.name}</span>
        </button>
        {open && (
          <ul className="flex flex-col gap-0.5">
            {node.children.map((child) => (
              <TreeNodeView
                key={child.path}
                node={child}
                depth={depth + 1}
                selectedPath={selectedPath}
                recentlyChanged={recentlyChanged}
                onSelect={onSelect}
              />
            ))}
          </ul>
        )}
      </li>
    );
  }
  const isSelected = selectedPath === node.path;
  const isChanged = recentlyChanged.has(node.path);
  return (
    <li>
      <button
        type="button"
        onClick={() => onSelect(node.path)}
        className={cn(
          "flex h-8 w-full cursor-pointer items-center justify-between gap-2 rounded-md px-2 text-left text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/35",
          isSelected && "bg-primary/15 text-blue-100",
        )}
        style={{ paddingLeft: depth * 12 + 16 }}
      >
        <span className="flex min-w-0 items-center gap-2">
          <FileText className="size-3.5 shrink-0" />
          <span className="truncate font-mono text-xs">{node.name}</span>
        </span>
        {isChanged && <span className="ml-2 size-1.5 shrink-0 rounded-full bg-amber-400" />}
      </button>
    </li>
  );
}
