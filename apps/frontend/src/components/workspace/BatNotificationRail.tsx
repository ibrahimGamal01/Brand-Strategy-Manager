'use client';

import { LiveActivityFeed } from '@/app/research/[id]/components/LiveActivityFeed';
import type { ResearchJobEvent } from '@/lib/api-client';

interface BatNotificationRailProps {
  events: ResearchJobEvent[];
  connectionState: 'connecting' | 'connected' | 'disconnected';
  onSelectEvent?: (event: ResearchJobEvent) => void;
}

export function BatNotificationRail({ events, connectionState, onSelectEvent }: BatNotificationRailProps) {
  return <LiveActivityFeed events={events} connectionState={connectionState} mode="rail" onSelectEvent={onSelectEvent} />;
}
