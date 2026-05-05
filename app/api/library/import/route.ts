import { NextResponse } from "next/server";
import { importLibrary } from "@/lib/library/export-import";
import type { LibraryExportFile } from "@/lib/library/types";
import { requireLibraryUser } from "../_auth";

function isLibraryExportFile(value: unknown): value is LibraryExportFile {
  return (
    typeof value === "object" &&
    value !== null &&
    "schemaVersion" in value &&
    value.schemaVersion === 1 &&
    "items" in value &&
    Array.isArray(value.items)
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const currentUser = await requireLibraryUser(request);
  if (!currentUser.ok) return currentUser.response;

  const file = await request.json().catch(() => null);

  if (!isLibraryExportFile(file)) {
    return NextResponse.json({ error: "invalid library export file" }, { status: 400 });
  }

  try {
    const result = await importLibrary({ userId: currentUser.userId, file });
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "invalid library export file" }, { status: 400 });
  }
}
