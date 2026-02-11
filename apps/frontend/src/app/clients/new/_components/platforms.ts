import { Instagram, Play, Twitter, Youtube } from 'lucide-react';

export const PLATFORMS = [
  { id: 'instagram', name: 'Instagram', icon: Instagram, placeholder: 'username' },
  { id: 'tiktok', name: 'TikTok', icon: Play, placeholder: 'username' },
  { id: 'youtube', name: 'YouTube', icon: Youtube, placeholder: 'channel' },
  { id: 'twitter', name: 'X/Twitter', icon: Twitter, placeholder: 'username' },
] as const;

export type PlatformId = (typeof PLATFORMS)[number]['id'];
