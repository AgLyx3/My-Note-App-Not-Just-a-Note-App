export interface EnrichedUrl {
  url: string;
  hostname: string;
  title_hint: string;
}

const DISALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

export function extractHttpUrls(text: string): string[] {
  const matches = text.match(/https?:\/\/[^\s)]+/gi) ?? [];
  const cleaned = matches.map((u) => u.replace(/[.,;!?]+$/g, ""));
  return [...new Set(cleaned)];
}

function isPublicHttpUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) return false;
    if (DISALLOWED_HOSTS.has(parsed.hostname)) return false;
    if (parsed.hostname.endsWith(".local")) return false;
    return true;
  } catch {
    return false;
  }
}

function titleHintFromHostname(hostname: string): string {
  const labels = hostname.split(".").filter(Boolean);
  const domain = labels.length >= 2 ? labels[labels.length - 2] : labels[0] ?? "link";
  return domain
    .split(/[-_]/g)
    .map((part) => (part.length ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export class UrlEnrichmentService {
  async enrichFromText(text: string): Promise<EnrichedUrl[]> {
    const urls = extractHttpUrls(text).filter(isPublicHttpUrl).slice(0, 3);
    return urls.map((url) => {
      const hostname = new URL(url).hostname;
      return {
        url,
        hostname,
        title_hint: `${titleHintFromHostname(hostname)} page`
      };
    });
  }
}
