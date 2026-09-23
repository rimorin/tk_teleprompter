import { MAX_DOCX_BYTES, MAX_SCRIPT_CHARS, MAX_TXT_BYTES } from '../config';

export class ImportError extends Error {}

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const ACCEPTED_FILE_TYPES = `.txt,.docx,text/plain,${DOCX_MIME}`;

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

function formatBytes(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(0)} MB` : `${Math.round(n / 1000)} KB`;
}

export function checkScriptLength(text: string, maxChars = MAX_SCRIPT_CHARS): string | null {
  if (text.length > maxChars) {
    return `Script is ${text.length.toLocaleString()} characters; the limit is ${maxChars.toLocaleString()}.`;
  }
  return null;
}

/**
 * Extract plain text from an uploaded .txt or .docx file. The .docx path uses mammoth's raw-text
 * extraction: no HTML is produced and no macros or embedded content are interpreted.
 */
export async function readScriptFile(file: File, maxChars = MAX_SCRIPT_CHARS): Promise<string> {
  const ext = extensionOf(file.name);
  let text: string;

  if (ext === 'txt') {
    if (file.size > MAX_TXT_BYTES) {
      throw new ImportError(`Text files must be under ${formatBytes(MAX_TXT_BYTES)}.`);
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.includes(0)) throw new ImportError('This file does not look like plain text.');
    text = new TextDecoder('utf-8').decode(bytes);
  } else if (ext === 'docx') {
    if (file.size > MAX_DOCX_BYTES) {
      throw new ImportError(`Word files must be under ${formatBytes(MAX_DOCX_BYTES)}.`);
    }
    const buffer = await file.arrayBuffer();
    const sig = new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength));
    if (sig[0] !== 0x50 || sig[1] !== 0x4b || sig[2] !== 0x03 || sig[3] !== 0x04) {
      throw new ImportError('This file is not a valid .docx document.');
    }
    const { default: mammoth } = await import('mammoth');
    try {
      text = (await mammoth.extractRawText({ arrayBuffer: buffer })).value;
    } catch {
      throw new ImportError('Could not read text from this .docx document.');
    }
  } else if (ext === 'pdf') {
    throw new ImportError('PDF import is not supported yet. Paste the text or use .txt/.docx.');
  } else {
    throw new ImportError('Unsupported file type. Use a .txt or .docx file.');
  }

  if (!text.trim()) throw new ImportError('The file contains no text.');
  const lengthError = checkScriptLength(text, maxChars);
  if (lengthError) throw new ImportError(lengthError);
  return text;
}
