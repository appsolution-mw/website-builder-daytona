export type TreeNode =
  | { kind: "file"; name: string; path: string }
  | { kind: "dir"; name: string; path: string; children: TreeNode[] };

interface MutableDir {
  kind: "dir";
  name: string;
  path: string;
  children: (MutableDir | MutableFile)[];
}
interface MutableFile {
  kind: "file";
  name: string;
  path: string;
}

export function buildTreeFromPaths(paths: string[]): TreeNode[] {
  const root: MutableDir = { kind: "dir", name: "", path: "", children: [] };

  for (const p of paths) {
    const parts = p.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    let cur: MutableDir = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      const dirPath = parts.slice(0, i + 1).join("/");
      if (isLast) {
        cur.children.push({ kind: "file", name: part, path: dirPath });
      } else {
        let next = cur.children.find(
          (c) => c.kind === "dir" && c.name === part,
        ) as MutableDir | undefined;
        if (!next) {
          next = { kind: "dir", name: part, path: dirPath, children: [] };
          cur.children.push(next);
        }
        cur = next;
      }
    }
  }

  const sort = (nodes: (MutableDir | MutableFile)[]) => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) {
      if (n.kind === "dir") sort(n.children);
    }
  };
  sort(root.children);

  return root.children as TreeNode[];
}
