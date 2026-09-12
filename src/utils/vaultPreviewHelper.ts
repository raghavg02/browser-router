import { execFile } from "child_process";

export interface ZipEntryInfo {
  name: string;
  size: number;
  compressedSize: number;
  isDirectory: boolean;
}

export interface AudioMetaInfo {
  title?: string;
  artist?: string;
  album?: string;
  year?: string;
  coverImageUri?: string;
}

/**
 * Parses ZIP Central Directory to list all archived files and sizes without extracting.
 */
export function inspectZipArchive(buffer: Buffer): {
  totalFiles: number;
  totalUncompressedSize: number;
  entries: ZipEntryInfo[];
} {
  const entries: ZipEntryInfo[] = [];
  let totalUncompressedSize = 0;

  try {
    // Look for End of Central Directory Record signature (0x06054b50) from the end of the buffer
    let eocdOffset = -1;
    const searchStart = Math.max(0, buffer.length - 65557);
    for (let i = buffer.length - 22; i >= searchStart; i--) {
      if (buffer.readUInt32LE(i) === 0x06054b50) {
        eocdOffset = i;
        break;
      }
    }

    if (eocdOffset === -1) {
      return { totalFiles: 0, totalUncompressedSize: 0, entries: [] };
    }

    const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
    const cdOffset = buffer.readUInt32LE(eocdOffset + 16);

    let offset = cdOffset;
    for (let i = 0; i < totalEntries && offset < buffer.length - 46; i++) {
      if (buffer.readUInt32LE(offset) !== 0x02014b50) {
        break;
      }

      const compressedSize = buffer.readUInt32LE(offset + 20);
      const uncompressedSize = buffer.readUInt32LE(offset + 24);
      const fileNameLength = buffer.readUInt16LE(offset + 28);
      const extraFieldLength = buffer.readUInt16LE(offset + 30);
      const fileCommentLength = buffer.readUInt16LE(offset + 32);

      const fileName = buffer.toString("utf8", offset + 46, offset + 46 + fileNameLength);
      const isDirectory = fileName.endsWith("/") || fileName.endsWith("\\");

      entries.push({
        name: fileName,
        size: uncompressedSize,
        compressedSize,
        isDirectory,
      });

      if (!isDirectory) {
        totalUncompressedSize += uncompressedSize;
      }

      offset += 46 + fileNameLength + extraFieldLength + fileCommentLength;
    }
  } catch {
    // fallback if zip is truncated or corrupted
  }

  return {
    totalFiles: entries.filter((e) => !e.isDirectory).length,
    totalUncompressedSize,
    entries,
  };
}

/**
 * Extracts readable introductory text streams and metadata from a decrypted PDF buffer.
 */
export function extractPdfPreview(buffer: Buffer): { textSnippet?: string; pageCount?: number } {
  try {
    const raw = buffer.toString("latin1");

    // Rough page count from /Type /Page (excluding /Pages)
    const pageMatches = raw.match(/\/Type\s*\/Page[^s]/g);
    const pageCount = pageMatches ? pageMatches.length : undefined;

    // Search for plain text stream blocks: BT ... ET
    const textFragments: string[] = [];
    const streamRegex = /BT[\s\S]*?ET/g;
    let match: RegExpExecArray | null;
    let totalChars = 0;

    while ((match = streamRegex.exec(raw)) !== null && totalChars < 1200) {
      const block = match[0];
      // Extract string literals in parentheses (text) or hex <text>
      const strRegex = /\(([^)]+)\)|\[([^\]]+)\]/g;
      let strMatch: RegExpExecArray | null;
      while ((strMatch = strRegex.exec(block)) !== null && totalChars < 1200) {
        const clean = (strMatch[1] || strMatch[2] || "")
          .replace(/\\n/g, "\n")
          .replace(/\\r/g, "")
          .replace(/\\t/g, " ")
          .replace(/\\[()]/g, "")
          .trim();
        if (clean.length > 2 && /[a-zA-Z0-9]/.test(clean)) {
          textFragments.push(clean);
          totalChars += clean.length;
        }
      }
    }

    const textSnippet = textFragments.length > 0 ? textFragments.join(" ").slice(0, 1000) : undefined;
    return { textSnippet, pageCount };
  } catch {
    return {};
  }
}

/**
 * Extracts ID3v2 metadata (Title, Artist, Album) and embedded album art JPEG/PNG from MP3 buffer.
 */
export function extractAudioMetadata(buffer: Buffer): AudioMetaInfo {
  const info: AudioMetaInfo = {};

  try {
    if (buffer.length < 10) return info;
    if (buffer.toString("latin1", 0, 3) !== "ID3") return info;

    const version = buffer.readUInt8(3);
    if (version !== 3 && version !== 4) return info;

    // Syncsafe integer for header size
    const size =
      ((buffer[6] & 0x7f) << 21) | ((buffer[7] & 0x7f) << 14) | ((buffer[8] & 0x7f) << 7) | (buffer[9] & 0x7f);

    let offset = 10;
    const end = Math.min(buffer.length, 10 + size);

    while (offset + 10 < end) {
      const frameId = buffer.toString("latin1", offset, offset + 4);
      if (!/^[A-Z0-9]{4}$/.test(frameId)) break;

      let frameSize = buffer.readUInt32BE(offset + 4);
      if (version === 4) {
        frameSize =
          ((buffer[offset + 4] & 0x7f) << 21) |
          ((buffer[offset + 5] & 0x7f) << 14) |
          ((buffer[offset + 6] & 0x7f) << 7) |
          (buffer[offset + 7] & 0x7f);
      }

      const frameDataOffset = offset + 10;
      if (frameDataOffset + frameSize > end || frameSize <= 1) {
        offset += 10 + frameSize;
        continue;
      }

      if (frameId === "TIT2") {
        info.title = buffer
          .toString("utf8", frameDataOffset + 1, frameDataOffset + frameSize)
          .replace(/\0/g, "")
          .trim();
      } else if (frameId === "TPE1") {
        info.artist = buffer
          .toString("utf8", frameDataOffset + 1, frameDataOffset + frameSize)
          .replace(/\0/g, "")
          .trim();
      } else if (frameId === "TALB") {
        info.album = buffer
          .toString("utf8", frameDataOffset + 1, frameDataOffset + frameSize)
          .replace(/\0/g, "")
          .trim();
      } else if (frameId === "TYER" || frameId === "TDRC") {
        info.year = buffer
          .toString("utf8", frameDataOffset + 1, frameDataOffset + frameSize)
          .replace(/\0/g, "")
          .trim();
      } else if (frameId === "APIC") {
        // Embedded picture
        try {
          let mimeEnd = frameDataOffset + 1;
          while (mimeEnd < frameDataOffset + frameSize && buffer[mimeEnd] !== 0) {
            mimeEnd++;
          }
          const mime = buffer.toString("latin1", frameDataOffset + 1, mimeEnd) || "image/jpeg";
          // Picture type at mimeEnd + 1
          let descEnd = mimeEnd + 2;
          while (descEnd < frameDataOffset + frameSize && buffer[descEnd] !== 0) {
            descEnd++;
          }
          const picStart = descEnd + 1;
          if (picStart < frameDataOffset + frameSize) {
            const picBuf = buffer.subarray(picStart, frameDataOffset + frameSize);
            info.coverImageUri = `data:${mime};base64,${picBuf.toString("base64")}`;
          }
        } catch {
          // ignore picture error
        }
      }

      offset += 10 + frameSize;
    }
  } catch {
    // ignore
  }

  return info;
}

/**
 * Formats CSV / TSV tabular content into a clean GitHub Flavored Markdown table.
 */
export function formatCsvAsTable(text: string, maxRows = 20): string {
  try {
    const lines = text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) return "";

    const isTab = lines[0].includes("\t") && !lines[0].includes(",");
    const delimiter = isTab ? "\t" : ",";

    function splitRow(row: string): string[] {
      if (isTab) return row.split("\t");
      // Basic CSV splitter handling quotes
      const res: string[] = [];
      let inQuotes = false;
      let cur = "";
      for (let i = 0; i < row.length; i++) {
        const c = row[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === delimiter && !inQuotes) {
          res.push(cur.trim());
          cur = "";
        } else {
          cur += c;
        }
      }
      res.push(cur.trim());
      return res;
    }

    const rows = lines.slice(0, maxRows).map(splitRow);
    if (rows.length === 0 || rows[0].length === 0) return "";

    const colCount = Math.max(...rows.map((r) => r.length));
    const header = rows[0];

    let md = "| " + header.map((h) => h.replace(/\|/g, "\\|") || " ").join(" | ") + " |\n";
    md += "| " + Array(colCount).fill(":---").join(" | ") + " |\n";

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const padded = Array.from({ length: colCount }, (_, idx) => (row[idx] || "").replace(/\|/g, "\\|"));
      md += "| " + padded.join(" | ") + " |\n";
    }

    if (lines.length > maxRows) {
      md += `\n*... showing first ${maxRows} of ${lines.length} rows*\n`;
    }

    return md;
  } catch {
    return "";
  }
}

/**
 * Invokes Windows Shell thumbnail API to extract a high-res image thumbnail (e.g. for Video, PDF).
 */
export async function extractWindowsThumbnail(filePath: string): Promise<string | null> {
  if (process.platform !== "win32") return null;

  const script = `
param([string]$p)
try {
  [Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime] | Out-Null
  $op = [Windows.Storage.StorageFile]::GetFileFromPathAsync($p)
  while ($op.Status -eq [Windows.Foundation.AsyncStatus]::Started) { Start-Sleep -Milliseconds 10 }
  $f = $op.GetResults()
  if (-not $f) { exit }
  $top = $f.GetThumbnailAsync([Windows.Storage.FileProperties.ThumbnailMode]::SingleItem, 600)
  while ($top.Status -eq [Windows.Foundation.AsyncStatus]::Started) { Start-Sleep -Milliseconds 10 }
  $t = $top.GetResults()
  if (-not $t -or $t.Size -eq 0) { exit }
  $b = New-Object byte[] $t.Size
  $r = New-Object Windows.Storage.Streams.DataReader($t.GetInputStreamAt(0))
  $rop = $r.LoadAsync($t.Size)
  while ($rop.Status -eq [Windows.Foundation.AsyncStatus]::Started) { Start-Sleep -Milliseconds 10 }
  $r.ReadBytes($b)
  $ct = $t.ContentType
  if (-not $ct) { $ct = "image/png" }
  [Console]::Write("DATA:" + $ct + ";" + [Convert]::ToBase64String($b))
} catch {}
`;

  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", script, "-p", filePath],
      { timeout: 4000, windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout) => {
        if (err || !stdout) return resolve(null);
        const out = stdout.trim();
        if (out.startsWith("DATA:")) {
          const parts = out.slice(5).split(";");
          if (parts.length === 2 && parts[1].length > 50) {
            return resolve(`data:${parts[0]};base64,${parts[1]}`);
          }
        }
        resolve(null);
      },
    );
  });
}
