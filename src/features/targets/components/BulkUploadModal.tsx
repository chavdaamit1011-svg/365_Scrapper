'use client';

import React, { useState, useRef } from 'react';
import { UploadCloud, FileSpreadsheet, CheckCircle2, AlertCircle, RefreshCw, X } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { Button } from '@/components/ui/Button';
import { TargetItem, ParseResult } from '../types/target.types';
import { parseTargetFile } from '../utils/parseTargetFile';

interface BulkUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddTargets: (targets: TargetItem[]) => void;
  existingTargets: TargetItem[];
}

export const BulkUploadModal: React.FC<BulkUploadModalProps> = ({
  isOpen,
  onClose,
  onAddTargets,
  existingTargets,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastResult, setLastResult] = useState<ParseResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const resetState = () => {
    setUploadError(null);
    setLastResult(null);
    setIsProcessing(false);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleClose = () => {
    resetState();
    onClose();
  };

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
      console.error('[BulkUploadModal Error]:', err);
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
    <Modal
      isOpen={isOpen}
      onClose={handleClose}
      title="Bulk Target Ingestion"
      description="Import domains or URLs in bulk from spreadsheets (.CSV, .XLSX, .XLS, .TXT)"
      maxWidth="540px"
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.xlsx,.xls,.txt,.tsv"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />

        {/* Drag & Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          style={{
            border: isDragging ? '2px dashed #0284c7' : '2px dashed #cbd5e1',
            background: isDragging ? '#f0f9ff' : '#f8fafc',
            borderRadius: '12px',
            padding: '36px 20px',
            textAlign: 'center',
            cursor: isProcessing ? 'not-allowed' : 'pointer',
            transition: 'all 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            <div
              style={{
                width: '48px',
                height: '48px',
                borderRadius: '12px',
                background: isDragging ? '#e0f2fe' : '#f1f5f9',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#0284c7',
                marginBottom: '4px',
              }}
            >
              {isProcessing ? (
                <RefreshCw size={26} color="#0284c7" className="animate-spin" />
              ) : (
                <UploadCloud size={26} color={isDragging ? '#0284c7' : '#0284c7'} />
              )}
            </div>

            <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text-main)' }}>
              {isProcessing
                ? 'Parsing targets from file...'
                : 'Click to choose file or drag & drop here'}
            </div>

            <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
              Supports <strong>.CSV</strong>, <strong>.XLSX</strong>, <strong>.XLS</strong>, <strong>.TXT</strong> (Up to 10,000 domains)
            </div>
          </div>
        </div>

        {/* Parse Success Report */}
        {lastResult && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#15803d',
              padding: '12px 16px',
              borderRadius: '8px',
              fontSize: '13px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <CheckCircle2 size={18} style={{ flexShrink: 0 }} />
              <span>
                Ingested <strong>{lastResult.targets.length}</strong> target{lastResult.targets.length > 1 ? 's' : ''} from{' '}
                <em>{lastResult.sourceFileName}</em>.
              </span>
            </div>

            {lastResult.duplicatesCount > 0 && (
              <span style={{ fontSize: '12px', color: '#16a34a', fontWeight: 600 }}>
                ({lastResult.duplicatesCount} duplicate{lastResult.duplicatesCount > 1 ? 's' : ''} skipped)
              </span>
            )}
          </div>
        )}

        {/* Upload Error Banner */}
        {uploadError && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '8px',
              background: '#fff1f2',
              border: '1px solid #fecdd3',
              color: '#be123c',
              padding: '12px 16px',
              borderRadius: '8px',
              fontSize: '13px',
            }}
          >
            <AlertCircle size={18} style={{ flexShrink: 0 }} />
            <span>{uploadError}</span>
          </div>
        )}

        {/* Footer Actions */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginTop: '6px' }}>
          <Button variant="secondary" size="md" onClick={handleClose}>
            {lastResult ? 'Done' : 'Cancel'}
          </Button>
          {lastResult && (
            <Button variant="primary" size="md" onClick={handleClose}>
              View Queue ({lastResult.targets.length} Added)
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};
