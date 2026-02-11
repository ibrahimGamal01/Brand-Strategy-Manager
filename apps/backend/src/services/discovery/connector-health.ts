export type ConnectorName =
  | 'ddg_social_search'
  | 'ddg_raw_query'
  | 'ddg_direct_search'
  | 'ddg_handle_validation'
  | 'ai_competitor_finder'
  | 'instagram_resolver'
  | 'tiktok_resolver';

export type ConnectorStatus = 'ok' | 'degraded';

export interface ConnectorSnapshot {
  name: ConnectorName;
  status: ConnectorStatus;
  reason?: string;
  occurredAt: string;
}

export class ConnectorHealthTracker {
  private readonly map = new Map<ConnectorName, ConnectorSnapshot>();

  markOk(name: ConnectorName): void {
    this.map.set(name, {
      name,
      status: 'ok',
      occurredAt: new Date().toISOString(),
    });
  }

  markDegraded(name: ConnectorName, reason: string): void {
    this.map.set(name, {
      name,
      status: 'degraded',
      reason: String(reason || 'Unknown connector issue').slice(0, 300),
      occurredAt: new Date().toISOString(),
    });
  }

  snapshot(): ConnectorSnapshot[] {
    return Array.from(this.map.values());
  }

  degradedNames(): ConnectorName[] {
    return this.snapshot()
      .filter((entry) => entry.status === 'degraded')
      .map((entry) => entry.name);
  }
}
