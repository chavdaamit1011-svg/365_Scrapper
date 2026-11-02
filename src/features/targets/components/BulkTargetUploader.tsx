'use client';

import React, { useState, useRef } from 'react';
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { TargetItem, ParseResult } from '../types/target.types';
import { parseTargetFile } from '../utils/parseTargetFile';

interface BulkTargetUploaderProps {
  onAddTargets: (targets: TargetItem[]) => void;
  existingTargets: TargetItem[];
}

export const BulkTargetUploader: React.FC<BulkTargetUploaderProps> = ({
  onAddTargets,
  existingTargets,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<ParseResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const processFile = async (file: File) => {
    setUploadError(null);
    setLastResult(null);

    const validExtensions = ['csv', 'xlsx', 'xls', 'txt', 'tsv'];
    const ext = file.name.split('.').pop()?.toLowerCase();

    if (!ext || !validExtensions.includes(ext)) {
      setUploadError(`Unsupported file format. Please upload a .CSV, .XLSX, .XLS, or .TXT file.`);
      return;
    }

    try {
      setIsProcessing(true);
      const result = await parseTargetFile(file, existingTargets);

      if (result.targets.length === 0) {
        setUploadError(
          `No new valid domains found in "${file.name}".` +
            (result.duplicatesCount > 0 ? ` (${result.duplicatesCount} already in queue)` : '')
        );
        return;
      }

      onAddTargets(result.targets);
      setLastResult(result);
    } catch (err: any) {
      console.error('[BulkTargetUploader Error]:', err);
      setUploadError(err.message || 'Failed to read file. Please verify file integrity.');
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  return (
    <Card style={{ padding: '22px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
        <div
          style={{
            width: '32px',
            height: '32px',
            borderRadius: '8px',
            background: '#ecfdf5',
            color: '#10b981',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <FileSpreadsheet size={18} />
        </div>
        <div>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
            Bulk Target Ingestion (CSV / Excel)
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Import target lists in bulk from .CSV, .XLSX, or .TXT spreadsheets
          </span>
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx,.xls,.txt,.tsv"
        onChange={handleFileChange}
        style={{ display: 'none' }}
      />

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        style={{
          marginTop: '14px',
          border: isDragging ? '2px dashed #0284c7' : '2px dashed #cbd5e1',
          background: isDragging ? '#f0f9ff' : '#f8fafc',
          borderRadius: '12px',
          padding: '24px 16px',
          textAlign: 'center',
          cursor: isProcessing ? 'not-allowed' : 'pointer',
          transition: 'all 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px' }}>
          {isProcessing ? (
            <RefreshCw size={24} color="#0284c7" className="animate-spin" />
          ) : (
            <UploadCloud size={24} color={isDragging ? '#0284c7' : '#64748b'} />
          )}

          <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--text-main)' }}>
            {isProcessing
              ? 'Parsing targets from file...'
              : 'Click to upload or drag & drop target file'}
          </div>

          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>
            Supported formats: <strong>.CSV</strong>, <strong>.XLSX</strong>, <strong>.XLS</strong>, <strong>.TXT</strong> (Max 10,000 lines)
          </div>
        </div>
      </div>

      {/* Parse Success Report */}
      {lastResult && (
        <div
          style={{
            marginTop: '12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: '#f0fdf4',
            border: '1px solid #bbf7d0',
            color: '#15803d',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '12.5px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <CheckCircle2 size={16} style={{ flexShrink: 0 }} />
            <span>
              Ingested <strong>{lastResult.targets.length}</strong> targets from{' '}
              <em>{lastResult.sourceFileName}</em>.
            </span>
          </div>

          {lastResult.duplicatesCount > 0 && (
            <span style={{ fontSize: '11.5px', color: '#16a34a' }}>
              ({lastResult.duplicatesCount} duplicate{lastResult.duplicatesCount > 1 ? 's' : ''} skipped)
            </span>
          )}
        </div>
      )}

      {/* Upload Error Banner */}
      {uploadError && (
        <div
          style={{
            marginTop: '12px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            background: '#fff1f2',
            border: '1px solid #fecdd3',
            color: '#be123c',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '12.5px',
          }}
        >
          <AlertCircle size={16} style={{ flexShrink: 0 }} />
          <span>{uploadError}</span>
        </div>
      )}
    </Card>
  );
};
