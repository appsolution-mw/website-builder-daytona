import { describe, it, expect } from "vitest";
import { buildTreeFromPaths, type TreeNode } from "../build-tree";

describe("buildTreeFromPaths", () => {
  it("returns an empty array for []", () => {
    expect(buildTreeFromPaths([])).toEqual([]);
  });

  it("renders a flat list", () => {
    const t = buildTreeFromPaths(["a.ts", "b.ts"]);
    expect(t).toEqual<TreeNode[]>([
      { kind: "file", name: "a.ts", path: "a.ts" },
      { kind: "file", name: "b.ts", path: "b.ts" },
    ]);
  });

  it("groups nested files under directory nodes", () => {
    const t = buildTreeFromPaths(["app/page.tsx", "app/layout.tsx", "README.md"]);
    expect(t).toEqual<TreeNode[]>([
      {
        kind: "dir",
        name: "app",
        path: "app",
        children: [
          { kind: "file", name: "layout.tsx", path: "app/layout.tsx" },
          { kind: "file", name: "page.tsx", path: "app/page.tsx" },
        ],
      },
      { kind: "file", name: "README.md", path: "README.md" },
    ]);
  });

  it("handles deeper nesting", () => {
    const t = buildTreeFromPaths(["app/api/a/route.ts", "app/api/b/route.ts"]);
    expect(t).toEqual<TreeNode[]>([
      {
        kind: "dir",
        name: "app",
        path: "app",
        children: [
          {
            kind: "dir",
            name: "api",
            path: "app/api",
            children: [
              {
                kind: "dir",
                name: "a",
                path: "app/api/a",
                children: [{ kind: "file", name: "route.ts", path: "app/api/a/route.ts" }],
              },
              {
                kind: "dir",
                name: "b",
                path: "app/api/b",
                children: [{ kind: "file", name: "route.ts", path: "app/api/b/route.ts" }],
              },
            ],
          },
        ],
      },
    ]);
  });

  it("sorts directories before files and both alphabetically", () => {
    const t = buildTreeFromPaths(["z.ts", "a/b.ts", "y.ts"]);
    expect(t.map((n) => n.name)).toEqual(["a", "y.ts", "z.ts"]);
  });
});
