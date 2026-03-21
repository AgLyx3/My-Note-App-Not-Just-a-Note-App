import { describe, expect, it } from "vitest";
import { extractHttpUrls, UrlEnrichmentService } from "../src/url-enrichment.js";

describe("url enrichment", () => {
  it("extracts unique http/https urls from text", () => {
    const urls = extractHttpUrls(
      "Read https://example.com/a and https://example.com/a plus http://news.ycombinator.com."
    );
    expect(urls).toEqual(["https://example.com/a", "http://news.ycombinator.com"]);
  });

  it("filters localhost/private-like hosts and returns title hints", async () => {
    const service = new UrlEnrichmentService();
    const enriched = await service.enrichFromText(
      "https://localhost:3000 https://example.com/something https://tool.local/page"
    );
    expect(enriched.length).toBe(1);
    expect(enriched[0].hostname).toBe("example.com");
    expect(enriched[0].title_hint).toContain("Example");
  });
});
