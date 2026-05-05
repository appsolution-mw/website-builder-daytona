const MAX_DNS_LABEL_LENGTH = 48;

export function createProjectPublicSlugCandidate(name: string): string {
  const normalized = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, MAX_DNS_LABEL_LENGTH)
    .replace(/-+$/g, "");

  return normalized || "project";
}
