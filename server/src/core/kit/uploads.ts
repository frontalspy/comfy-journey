import type { Request, Response } from "express";
import multer from "multer";

export interface UploadParserOptions {
  /** Multipart field name holding the file. Default "image". */
  field?: string;
  maxBytes: number;
}

export interface ParsedUpload {
  buffer: Buffer;
  originalName: string;
  mimeType: string;
  size: number;
}

export type UploadParseResult =
  | { ok: true; file: ParsedUpload }
  | { ok: false; status: 400; error: string };

/**
 * A single-file multipart parser, buffered in memory (multer never touches disk here). Returned
 * as an awaitable function rather than route middleware on purpose: routes check that the
 * caller may touch the record BEFORE reading the upload, and the declared Content-Type is never
 * trusted — callers validate by decoding (the thumbnailer decodes every image with sharp).
 */
export function createUploadParser(
  options: UploadParserOptions,
): (req: Request, res: Response) => Promise<UploadParseResult> {
  // @types/multer is typed against whichever @types/express npm hoists, not necessarily this
  // package's own copy (both APIs are on Express 5 now, but the two can still drift on a
  // version bump) — the runtime contract is identical, so narrow it to the (req, res, callback)
  // shape it actually has rather than coupling this call site to the hoisted typings.
  const parse = multer({ limits: { fileSize: options.maxBytes, files: 1 } }).single(
    options.field ?? "image",
  ) as unknown as (req: Request, res: Response, callback: (err: unknown) => void) => void;

  return async (req, res) => {
    const parseError = await new Promise<unknown>((resolve) => {
      parse(req, res, (err: unknown) => resolve(err));
    });
    if (parseError) return { ok: false, status: 400, error: "Upload too large or malformed." };
    if (!req.file) return { ok: false, status: 400, error: "No image file provided." };
    return {
      ok: true,
      file: {
        buffer: req.file.buffer,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
      },
    };
  };
}
