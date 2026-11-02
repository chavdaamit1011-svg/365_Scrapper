'use client';

import React, { useState } from 'react';
import { Search, Trash2, Copy, Check, Globe, FileSpreadsheet, ListFilter, Download, Play } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TargetItem, TargetType } from '../types/target.types';

interface TargetQueueTableProps {
  targets: TargetItem[];
  onRemoveTarget: (id: string) => void;
  onClearAll: () => void;
  onStartCrawler?: () => void;
  isCrawling?: boolean;
}

export const TargetQueueTable: React.FC<TargetQueueTableProps> = ({
  targets,
  onRemoveTarget,
  onClearAll,
  onStartCrawler,
  isCrawling = false,
}) => {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | TargetType>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const filtered = targets.filter((t) => {
    const matchesSearch = t.domain.toLowerCase().includes(search.toLowerCase());
    const matchesType = filterType === 'all' || t.type === filterType;
    return matchesSearch && matchesType;
  });

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleExportCsv = () => {
    if (targets.length === 0) return;
    const header = 'Domain,Type,Source,FileName,AddedAt\n';
    const rows = targets
      .map((t) => `"${t.domain}","${t.type}","${t.source}","${t.fileName || ''}","${t.addedAt}"`)
      .join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `the-scrapper-targets-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rootDomainCount = targets.filter((t) => t.type === 'root_domain').length;
  const subdomainCount = targets.filter((t) => t.type === 'subdomain').length;

  return (
    <Card style={{ padding: '24px' }}>
      {/* Table Header & Controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '14px',
          marginBottom: '18px',
          paddingBottom: '16px',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              Ingested Target Scope
            </h2>
            <Badge variant="primary">{targets.length} Ready</Badge>
          </div>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px', margin: 0 }}>
            {rootDomainCount} Root Domains &bull; {subdomainCount} Subdomains loaded in queue.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {targets.length > 0 && (
            <>
              {onStartCrawler && !isCrawling && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={onStartCrawler}
                  leftIcon={<Play size={13} fill="currentColor" />}
                >
                  Start Crawler
                </Button>
              )}
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportCsv}
                leftIcon={<Download size={13} />}
              >
                Export CSV
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={onClearAll}
                leftIcon={<Trash2 size={13} />}
              >
                Clear All
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '16px',
        }}
      >
        <div style={{ position: 'relative', width: '100%', maxWidth: '320px' }}>
          <input
            type="text"
            placeholder="Search loaded domains..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="spatial-input"
            style={{ paddingLeft: '36px', fontSize: '12.5px', padding: '8px 12px 8px 36px' }}
          />
          <Search
            size={15}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
          />
        </div>

        {/* Type Filter Buttons */}
        <div style={{ display: 'flex', gap: '6px' }}>
          {(
            [
              { id: 'all', label: `All (${targets.length})` },
              { id: 'root_domain', label: `Root (${rootDomainCount})` },
              { id: 'subdomain', label: `Subdomains (${subdomainCount})` },
            ] as const
          ).map((btn) => (
            <button
              key={btn.id}
              type="button"
              onClick={() => setFilterType(btn.id)}
              style={{
                padding: '6px 12px',
                borderRadius: '6px',
                fontSize: '11.5px',
                fontWeight: 600,
                border: '1px solid #e2e8f0',
                background: filterType === btn.id ? '#0284c7' : '#ffffff',
                color: filterType === btn.id ? '#ffffff' : '#64748b',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {btn.label}
            </button>
          ))}
        </div>
      </div>

      {/* Targets Table */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '12px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: 'var(--text-muted)' }}>
                <th style={{ padding: '12px 16px', fontWeight: 600, width: '50px' }}>#</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Target Domain / Subdomain</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Scope Type</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Ingestion Source</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Added At</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {targets.length === 0
                      ? 'No targets ingested yet. Enter domains manually or upload a CSV / Excel file above.'
                      : 'No loaded targets match your search.'}
                  </td>
                </tr>
              ) : (
                filtered.map((t, idx) => (
                  <tr
                    key={t.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    <td style={{ padding: '12px 16px', color: 'var(--text-subtle)', fontSize: '11.5px' }}>
                      {idx + 1}
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 600, color: 'var(--text-main)', fontSize: '13px' }}>
                          {t.domain}
                        </span>
                        <button
                          type="button"
                          onClick={() => handleCopy(t.domain, t.id)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            cursor: 'pointer',
                            padding: 2,
                            color: copiedId === t.id ? '#16a34a' : '#94a3b8',
                            display: 'flex',
                            alignItems: 'center',
                          }}
                          title="Copy target"
                        >
                          {copiedId === t.id ? <Check size={13} /> : <Copy size={13} />}
                        </button>
                      </div>
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      <Badge variant={t.type === 'subdomain' ? 'warning' : 'primary'}>
                        {t.type === 'subdomain' ? 'SUBDOMAIN' : 'ROOT DOMAIN'}
                      </Badge>
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {t.source === 'manual' ? (
                          <Globe size={13} color="#0284c7" />
                        ) : (
                          <FileSpreadsheet size={13} color="#10b981" />
                        )}
                        <span style={{ fontSize: '11.5px', color: '#475569' }}>
                          {t.source === 'manual'
                            ? 'Manual Input'
                            : `${t.fileName || 'Bulk Upload'}`}
                        </span>
                      </div>
                    </td>

                    <td style={{ padding: '12px 16px', color: 'var(--text-muted)', fontSize: '11.5px' }}>
                      {new Date(t.addedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>

                    <td style={{ padding: '12px 16px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={() => onRemoveTarget(t.id)}
                        className="spatial-btn-secondary"
                        style={{
                          padding: '5px 8px',
                          borderRadius: '6px',
                          fontSize: '11px',
                          color: '#e11d48',
                          border: '1px solid #fee2e2',
                          cursor: 'pointer',
                        }}
                        title="Remove from queue"
                      >
                        <Trash2 size={13} />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
};

