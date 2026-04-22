"use client";

import { useState } from "react";
import { buildTreeFromPaths, type TreeNode } from "@/lib/tree/build-tree";

export interface FileTreeProps {
  paths: string[];
  selectedPath: string | null;
  recentlyChanged: Set<string>;
  onSelect: (path: string) => void;
}

export function FileTree(props: FileTreeProps) {
  const tree = buildTreeFromPaths(props.paths);
  if (tree.length === 0) {
    return <div className="p-3 text-xs text-gray-400">Loading files…</div>;
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
          className="flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-gray-100"
          style={{ paddingLeft: depth * 12 + 4 }}
        >
          <span className="text-gray-400">{open ? "▾" : "▸"}</span>
          <span className="text-gray-700">{node.name}</span>
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
        className={`flex w-full items-center justify-between rounded px-1 py-0.5 text-left hover:bg-gray-100 ${
          isSelected ? "bg-blue-50 text-blue-900" : ""
        }`}
        style={{ paddingLeft: depth * 12 + 16 }}
      >
        <span className="truncate font-mono text-xs">{node.name}</span>
        {isChanged && <span className="ml-2 h-1.5 w-1.5 rounded-full bg-amber-500" />}
      </button>
    </li>
  );
}
