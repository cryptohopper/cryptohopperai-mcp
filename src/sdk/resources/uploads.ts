import type { CryptohopperClient } from "../client.js";
import { CryptohopperError } from "../errors.js";

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".csv": "text/csv",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const MAX_BYTES = 5 * 1024 * 1024;

export function guessMimeType(fileName: string): string | null {
  const lower = fileName.toLowerCase();
  const dot = lower.lastIndexOf(".");
  if (dot < 0) return null;
  return EXT_TO_MIME[lower.slice(dot)] ?? null;
}

export interface UploadPresignResponse {
  uploadUrl: string;
  key: string;
  fileId: string;
}

export interface UploadedAttachment {
  key: string;
  fileName: string;
  fileType: string;
  fileSize: number;
}

export interface CreateUploadInput {
  fileName: string;
  file: Buffer | Uint8Array | Blob;
  /** Override the guessed mime-type. Must be on the backend allowlist. */
  fileType?: string;
}

export class Uploads {
  constructor(private readonly client: CryptohopperClient) {}

  async create(input: CreateUploadInput): Promise<UploadedAttachment> {
    const fileType = input.fileType ?? guessMimeType(input.fileName);
    if (!fileType || !Object.values(EXT_TO_MIME).includes(fileType)) {
      throw new CryptohopperError({
        code: "VALIDATION_ERROR",
        message: `Unsupported file type for ${input.fileName}. Allowed: png, jpg, gif, svg, webp, ico, pdf, txt, csv, doc, docx.`,
        status: 0,
      });
    }

    const fileSize =
      input.file instanceof Blob ? input.file.size : (input.file as Uint8Array).byteLength;
    if (fileSize > MAX_BYTES) {
      throw new CryptohopperError({
        code: "VALIDATION_ERROR",
        message: `${input.fileName} is ${Math.round(fileSize / 1024 / 1024)} MB — the upload limit is 5 MB.`,
        status: 0,
      });
    }

    const presign = await this.client.__request<UploadPresignResponse>(
      "POST",
      "/api/v1/uploads",
      { fileName: input.fileName, fileType, fileSize },
    );

    // S3 PUT uses the client's injected fetch (so tests can observe it),
    // but bypasses the JSON envelope — S3 replies with XML / empty.
    const fetchImpl = this.client.__internalFetch();
    const put = await fetchImpl(presign.uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": fileType },
      // Buffer / Uint8Array / Blob are all valid fetch body types at runtime.
      // The lib-dom BodyInit isn't pulled in by our tsconfig, so cast through unknown.
      body: input.file as unknown as string,
    });
    if (!put.ok) {
      throw new CryptohopperError({
        code: "UNKNOWN",
        message: `S3 upload failed (${put.status} ${put.statusText})`,
        status: put.status,
      });
    }

    return { key: presign.key, fileName: input.fileName, fileType, fileSize };
  }
}
