import { Instagram, Linkedin, Play, Twitter, Youtube } from "lucide-react";

export const PLATFORMS = [
  { id: "instagram", name: "Instagram", icon: Instagram, placeholder: "username" },
  { id: "tiktok", name: "TikTok", icon: Play, placeholder: "username" },
  { id: "youtube", name: "YouTube", icon: Youtube, placeholder: "channel" },
  { id: "linkedin", name: "LinkedIn", icon: Linkedin, placeholder: "profile or company" },
  { id: "twitter", name: "X/Twitter", icon: Twitter, placeholder: "username" },
] as const;

export type PlatformId = (typeof PLATFORMS)[number]["id"];
