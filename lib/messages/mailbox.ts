/** Mailbox from a bare address or a display form such as `Name <email>`. */
export function mailboxAddress(value: string | null | undefined): string | null {
  if (!value || typeof value !== "string") return null;
  const trimmed = value.trim();
  const bracket = trimmed.match(/<([^>]+)>/);
  const email = (bracket ? bracket[1] : trimmed).trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
