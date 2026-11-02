import { TargetItem, TargetSource, ParseResult } from '../types/target.types';
import { cleanDomainString, isValidTarget, classifyTargetType } from './domainValidator';

/**
 * Parses an uploaded target file (CSV, Excel XLSX/XLS, TXT, TSV) in the browser
 */
export async function parseTargetFile(
  file: File,
  existingTargets: TargetItem[] = []
): Promise<ParseResult> {
  const extension = file.name.split('.').pop()?.toLowerCase() || '';
  const existingSet = new Set(existingTargets.map((t) => t.domain.toLowerCase()));

  let rawTokens: string[] = [];
  let source: TargetSource = 'file_txt';

  if (extension === 'csv' || extension === 'tsv' || extension === 'txt') {
    source = extension === 'csv' ? 'file_csv' : 'file_txt';
    const text = await file.text();
    // Split by newlines, commas, semicolons, tabs, and spaces
    rawTokens = text.split(/[\r\n,;\t\s]+/);
  } else if (extension === 'xlsx' || extension === 'xls') {
    source = 'file_excel';
    // For Excel files, read as ArrayBuffer and extract UTF-8 text strings
    const buffer = await file.arrayBuffer();
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const content = decoder.decode(buffer);

    // Extract potential domain-like strings from Excel XML/binary payload
    const matches = content.match(/[a-zA-Z0-9]([a-zA-Z0-9\-\.]{1,61}[a-zA-Z0-9])\.[a-zA-Z]{2,10}/g);
    rawTokens = matches || [];
  } else {
    // Generic fallback: read as text
    const text = await file.text();
    rawTokens = text.split(/[\r\n,;\t\s]+/);
  }

  const seenInBatch = new Set<string>();
  const validTargets: TargetItem[] = [];
  let duplicatesCount = 0;
  let invalidCount = 0;

  for (const token of rawTokens) {
    if (!token) continue;

    const cleaned = cleanDomainString(token);
    if (!cleaned) continue;

    if (!isValidTarget(cleaned)) {
      invalidCount++;
      continue;
    }

    if (existingSet.has(cleaned) || seenInBatch.has(cleaned)) {
      duplicatesCount++;
      continue;
    }

    seenInBatch.add(cleaned);
    const targetType = classifyTargetType(cleaned);

    validTargets.push({
      id: `tgt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      domain: cleaned,
      type: targetType,
      source,
      fileName: file.name,
      addedAt: new Date().toISOString(),
    });
  }

  return {
    targets: validTargets,
    duplicatesCount,
    invalidCount,
    totalParsed: rawTokens.length,
    sourceFileName: file.name,
  };
}

