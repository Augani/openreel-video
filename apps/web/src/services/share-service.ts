import { OPENREEL_CLOUD_URL } from "../config/api-endpoints";

export interface ShareResult {
  shareId: string;
  shareUrl: string;
  expiresAt: number;
}

export interface ShareInfo {
  shareId: string;
  filename: string;
  size: number;
  expiresAt: number;
  expiresIn: number;
}

export interface ShareError {
  error: string;
}

export type UploadProgressCallback = (progress: number) => void;

export async function uploadForSharing(
  blob: Blob,
  filename: string,
  onProgress?: UploadProgressCallback,
): Promise<ShareResult> {
  const formData = new FormData();
  formData.append("file", blob, filename);

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.upload.addEventListener("progress", (event) => {
      if (event.lengthComputable && onProgress) {
        const progress = (event.loaded / event.total) * 100;
        onProgress(progress);
      }
    });

    xhr.addEventListener("load", () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const response = JSON.parse(xhr.responseText);
          resolve(response);
        } catch {
          reject(new Error("Invalid response from server"));
        }
      } else {
        try {
          const errorResponse = JSON.parse(xhr.responseText);
          reject(
            new Error(
              errorResponse.error || `Upload failed with status ${xhr.status}`,
            ),
          );
        } catch {
          reject(new Error(`Upload failed with status ${xhr.status}`));
        }
      }
    });

    xhr.addEventListener("error", () => {
      reject(new Error("Network error during upload"));
    });

    xhr.addEventListener("abort", () => {
      reject(new Error("Upload was cancelled"));
    });

    xhr.open("POST", `${OPENREEL_CLOUD_URL}/shares`);
    xhr.send(formData);
  });
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

export function getSharePageUrl(shareId: string): string {
  const baseUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}${window.location.pathname}`
      : "";
  return `${baseUrl}#/share/${shareId}`;
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

export async function checkShareHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${OPENREEL_CLOUD_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}
