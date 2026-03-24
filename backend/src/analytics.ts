export interface AnalyticsEventInput {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
}

export interface AnalyticsClient {
  track(input: AnalyticsEventInput): Promise<void>;
}

class NoopAnalyticsClient implements AnalyticsClient {
  async track(_input: AnalyticsEventInput): Promise<void> {
    return;
  }
}

class PostHogAnalyticsClient implements AnalyticsClient {
  constructor(
    private readonly apiKey: string,
    private readonly host: string
  ) {}

  async track(input: AnalyticsEventInput): Promise<void> {
    try {
      await fetch(`${this.host.replace(/\/$/, "")}/capture/`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          api_key: this.apiKey,
          event: input.event,
          distinct_id: input.distinctId,
          properties: input.properties ?? {},
          timestamp: input.timestamp
        })
      });
    } catch {
      // Telemetry must not break product behavior.
    }
  }
}

export function buildAnalyticsClientFromEnv(): AnalyticsClient {
  const apiKey = process.env.POSTHOG_API_KEY?.trim();
  if (!apiKey) return new NoopAnalyticsClient();
  const host = process.env.POSTHOG_HOST?.trim() || "https://us.i.posthog.com";
  return new PostHogAnalyticsClient(apiKey, host);
}

