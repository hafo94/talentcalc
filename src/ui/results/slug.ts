/** "Seal of Command (proc)" -> "seal-of-command-proc" (test ids). */
export const slug = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
