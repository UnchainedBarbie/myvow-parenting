const PHONE = /^(?:mobile|phone|cell|tel|office|fax)\s*:/i;
const MOBILE_CLIENT = /^(?:sent from my \w|get outlook for )/i;

function isNoticeLine(line: string): boolean {
  const trimmed = line.trim();
  if (/^confidentiality notice:?$/i.test(trimmed)) return true;
  if (/^this (?:e-?mail|email|message) and any attachments are intended/i.test(trimmed)) return true;
  if (/^intended solely for the use of the individual or entity/i.test(trimmed)) return true;
  if (/^if you (?:have |are )?received this (?:e-?mail|email|message) in error/i.test(trimmed)) return true;
  if (/^unauthorized (?:review|use|disclosure|distribution)/i.test(trimmed)) return true;
  return /privileged and confidential/i.test(trimmed) && trimmed.length < 400;
}

function isNameTitleLine(line: string): boolean {
  const match = line.match(/^([^|]{1,60})\|\s*(\S.*)$/);
  if (!match) return false;
  const name = match[1].trim();
  const title = match[2].trim();
  if (name.length > 40 || title.length > 40) return false;
  if (/\d/.test(name) || /[?]/.test(line)) return false;
  const words = name.split(/\s+/);
  if (words.length < 2 || words.length > 4) return false;
  return words.every((word) => /^[A-Za-z][A-Za-z.'-]*$/.test(word));
}

function isContactLine(line: string): boolean {
  const trimmed = line.trim();
  if (/<mailto:/i.test(trimmed) && trimmed.length < 200) return true;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

function isSignatureLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes("?")) return false;
  if (isNoticeLine(trimmed)) return true;
  if (PHONE.test(trimmed)) return true;
  if (MOBILE_CLIENT.test(trimmed)) return true;
  if (/^--\s*$/.test(trimmed)) return true;
  if (isContactLine(trimmed)) return true;
  return isNameTitleLine(trimmed);
}

function isStrongSignatureLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.includes("?")) return false;
  if (isNoticeLine(trimmed)) return true;
  if (PHONE.test(trimmed)) return true;
  if (MOBILE_CLIENT.test(trimmed)) return true;
  if (/^--\s*$/.test(trimmed)) return true;
  return isContactLine(trimmed);
}

export function renderRecordBody(original: string | null | undefined): {
  text: string;
  omitted: boolean;
} {
  const raw = (original ?? "").replace(/\r\n/g, "\n");
  if (!raw.trim()) return { text: "[No message body]", omitted: false };

  const lines = raw.split("\n");
  let index = lines.length - 1;
  let sawSignature = false;
  let sawStrong = false;
  while (index >= 0) {
    const line = lines[index];
    if (!line.trim()) {
      index -= 1;
      continue;
    }
    if (!isSignatureLine(line)) break;
    sawSignature = true;
    if (isStrongSignatureLine(line)) sawStrong = true;
    index -= 1;
  }

  if (!sawSignature || !sawStrong) return { text: raw.trim(), omitted: false };

  const kept = lines.slice(0, index + 1).join("\n").trim();
  if (!kept) {
    return { text: "[Signature and confidentiality notice omitted]", omitted: false };
  }
  return { text: kept, omitted: true };
}
