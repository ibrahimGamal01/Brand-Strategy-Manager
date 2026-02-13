export type ReRequestTargetKind =
  | 'brand_mention'
  | 'client_post'
  | 'social_post';

export interface ReRequestTarget {
  kind: ReRequestTargetKind;
  id: string;
}

export interface NormalizedReRequestJob {
  type: ReRequestTargetKind;
  id: string;
}

export type ReRequestStatus = 'ok' | 'failed' | 'skipped';

export interface ReRequestResult {
  id: string;
  type: ReRequestTargetKind;
  status: ReRequestStatus;
  error?: string;
}

