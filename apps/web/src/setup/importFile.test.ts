import { describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { ImportError, readScriptFile } from './importFile';

function file(content: BlobPart[], name: string, type = '') {
  return new File(content, name, { type });
}

async function makeDocx(paragraphs: string[]): Promise<Uint8Array> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  const body = paragraphs.map((p) => `<w:p><w:r><w:t xml:space="preserve">${p}</w:t></w:r></w:p>`);
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body.join('')}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'uint8array' });
}

describe('readScriptFile', () => {
  it('reads UTF-8 text files', async () => {
    await expect(readScriptFile(file(['Héllo\n\nworld'], 'talk.txt'))).resolves.toBe(
      'Héllo\n\nworld',
    );
  });

  it('rejects binary content disguised as .txt', async () => {
    await expect(readScriptFile(file([new Uint8Array([72, 0, 73])], 'x.txt'))).rejects.toThrow(
      ImportError,
    );
  });

  it('rejects unsupported and PDF files with a clear message', async () => {
    await expect(readScriptFile(file(['x'], 'talk.pdf'))).rejects.toThrow(/PDF import/);
    await expect(readScriptFile(file(['x'], 'talk.rtf'))).rejects.toThrow(/Unsupported/);
  });

  it('rejects text over the character limit', async () => {
    await expect(readScriptFile(file(['abcdef'], 'a.txt'), 5)).rejects.toThrow(/limit is 5/);
  });

  it('rejects empty files', async () => {
    await expect(readScriptFile(file(['  \n'], 'a.txt'))).rejects.toThrow(/no text/);
  });

  it('rejects .docx files without a zip signature', async () => {
    await expect(readScriptFile(file(['not a zip'], 'a.docx'))).rejects.toThrow(/valid .docx/);
  });

  it('extracts paragraphs from .docx as plain text without interpreting markup', async () => {
    const docx = await makeDocx(['First &lt;b&gt;para&lt;/b&gt;.', 'Second para.']);
    const text = await readScriptFile(file([docx as BlobPart], 'talk.docx'));
    expect(text.trim().split(/\n\n+/)).toEqual(['First <b>para</b>.', 'Second para.']);
  });
});
