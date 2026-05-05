import { NextResponse } from "next/server";
import { exportLibrary } from "@/lib/library/export-import";
import { requireLibraryUser } from "../_auth";

export async function GET(request: Request): Promise<NextResponse> {
  const currentUser = await requireLibraryUser(request);
  if (!currentUser.ok) return currentUser.response;

  const file = await exportLibrary({ userId: currentUser.userId });
  return NextResponse.json(file);
}
