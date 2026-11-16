import { OPENREEL_CLOUD_URL } from "../config/api-endpoints";

export interface ShareInfo {
  shareId: string;
  filename: string;
  size: number;
  expiresAt: number;
  expiresIn: number;
}

export async function getShareInfo(shareId: string): Promise<ShareInfo | null> {
  try {
    const response = await fetch(`${OPENREEL_CLOUD_URL}/shares/${shareId}`);

    if (response.status === 404) {
      return null;
    }

    if (response.status === 410) {
      throw new Error("This share link has expired");
    }

    if (!response.ok) {
      throw new Error(`Failed to get share info: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error("Failed to get share info");
  }
}

export function getShareDownloadUrl(shareId: string): string {
  return `${OPENREEL_CLOUD_URL}/shares/${shareId}/download`;
}

export function formatExpiresIn(expiresAt: number): string {
  const now = Date.now();
  const diff = expiresAt - now;

  if (diff <= 0) {
    return "Expired";
  }

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m remaining`;
  }

  return `${minutes}m remaining`;
}

export function isShareExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt;
}
