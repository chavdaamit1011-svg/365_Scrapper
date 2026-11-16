'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Trash2, Copy, Check, Globe, FileSpreadsheet, ListFilter, Download, Play } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { TargetItem, TargetType } from '../types/target.types';

interface TargetQueueTableProps {
  targets: TargetItem[];
  activeTarget?: TargetItem | null;
  onRemoveTarget: (id: string) => void;
  onClearAll: () => void;
  onStartCrawler?: () => void;
  isCrawling?: boolean;
  cycleCount?: number;
}

export const TargetQueueTable: React.FC<TargetQueueTableProps> = ({
  targets,
  activeTarget,
  onRemoveTarget,
  onClearAll,
  onStartCrawler,
  isCrawling = false,
  cycleCount = 1,
}) => {
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState<'all' | TargetType>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // STRICT RULE: Target Queue table ONLY shows pending targets waiting in line to be crawled!
  // Completed, cancelled (stopped), or active crawling domains are never shown in the pending queue.
  const pendingTargets = targets.filter((t) => !t.status || t.status === 'pending');

  const filtered = pendingTargets.filter((t) => {
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
    if (pendingTargets.length === 0) return;
    const header = 'Domain,Type,Source,FileName,AddedAt\n';
    const rows = pendingTargets
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

  const rootDomainCount = pendingTargets.filter((t) => t.type === 'root_domain').length;
  const subdomainCount = pendingTargets.filter((t) => t.type === 'subdomain').length;
  const tldZoneCount = pendingTargets.filter((t) => t.type === 'tld_zone').length;

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
            <Badge variant="primary">{pendingTargets.length} Ready</Badge>
          </div>
          <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px', margin: 0 }}>
            {rootDomainCount} Root Domains &bull; {subdomainCount} Subdomains{tldZoneCount > 0 ? ` &bull; ${tldZoneCount} TLD 24/7 Zones` : ''} loaded in queue.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          {pendingTargets.length > 0 && (
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
                Clear Queue
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

        {/* Type Filter Buttons with Smooth Animated Sliding Indicator */}
        <div
          style={{
            display: 'flex',
            gap: '4px',
            background: '#f1f5f9',
            padding: '3px',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            position: 'relative',
          }}
        >
          {(
            [
              { id: 'all', label: `All (${pendingTargets.length})` },
              { id: 'root_domain', label: `Root (${rootDomainCount})` },
              { id: 'subdomain', label: `Subdomains (${subdomainCount})` },
              ...(tldZoneCount > 0 ? [{ id: 'tld_zone' as const, label: `TLD Zones (${tldZoneCount})` }] : []),
            ] as const
          ).map((btn) => (
            <motion.button
              key={btn.id}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              type="button"
              onClick={() => setFilterType(btn.id)}
              style={{
                position: 'relative',
                padding: '6px 14px',
                borderRadius: '6px',
                fontSize: '11.5px',
                fontWeight: 600,
                border: 'none',
                background: 'transparent',
                color: filterType === btn.id ? '#0284c7' : '#64748b',
                cursor: 'pointer',
                zIndex: 1,
                outline: 'none',
                transition: 'color 0.18s ease',
              }}
            >
              {filterType === btn.id && (
                <motion.div
                  layoutId="queueFilterTabPill"
                  transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: '#ffffff',
                    borderRadius: '6px',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                    zIndex: -1,
                  }}
                />
              )}
              {btn.label}
            </motion.button>
          ))}
        </div>
      </div>

      {/* Sequential Processing Active Domain Banner */}
      {activeTarget && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 18px',
            background: '#f0f9ff',
            border: '1px solid #bae6fd',
            borderRadius: '10px',
            marginBottom: '14px',
            flexWrap: 'wrap',
            gap: '10px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span
              style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#0284c7',
                animation: 'pulse 1.2s infinite ease-in-out',
              }}
            />
            <div>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#0369a1' }}>
                ⚡ Currently Processing Active Domain: {activeTarget.domain}
              </span>
              <p style={{ margin: '2px 0 0', fontSize: '11.5px', color: '#0284c7' }}>
                Sequential Pipeline: Only 1 domain at a time. The queued domains below will run automatically one-by-one once this finishes.
              </p>
            </div>
          </div>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 700,
              color: '#0369a1',
              background: '#e0f2fe',
              padding: '3px 10px',
              borderRadius: '9999px',
              border: '1px solid #bae6fd',
            }}
          >
            {filtered.length} Domains in Line
          </span>
        </div>
      )}

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
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Queue Status</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Scope Type</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Ingestion Source</th>
                <th style={{ padding: '12px 16px', fontWeight: 600 }}>Added At</th>
                <th style={{ padding: '12px 16px', fontWeight: 600, textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <AnimatePresence mode="wait">
              <motion.tbody
                key={filterType + search}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: 'easeOut' }}
              >
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: '40px 18px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    {activeTarget
                      ? `⚡ Currently crawling ${activeTarget.domain}. Queue is empty (0 upcoming domains waiting).`
                      : pendingTargets.length === 0
                      ? 'No targets in queue. Enter domains manually or upload a CSV / Excel file above to start.'
                      : 'No queued targets match your search.'}
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

                    {/* Queue Status */}
                    <td style={{ padding: '12px 16px' }}>
                      {isCrawling ? (
                        idx === 0 ? (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 9px',
                              borderRadius: '9999px',
                              fontSize: '11px',
                              fontWeight: 700,
                              background: '#e0f2fe',
                              color: '#0369a1',
                              border: '1px solid #bae6fd',
                            }}
                          >
                            ⏳ NEXT IN LINE (Starts next)
                          </span>
                        ) : (
                          <span
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: '4px',
                              padding: '3px 9px',
                              borderRadius: '9999px',
                              fontSize: '11px',
                              fontWeight: 600,
                              background: '#f1f5f9',
                              color: '#475569',
                              border: '1px solid #e2e8f0',
                            }}
                          >
                            {`⏳ QUEUED (#${idx + 1} in queue)`}
                          </span>
                        )
                      ) : (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '3px 9px',
                            borderRadius: '9999px',
                            fontSize: '11px',
                            fontWeight: 600,
                            background: '#ecfdf5',
                            color: '#15803d',
                            border: '1px solid #bbf7d0',
                          }}
                        >
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: '#16a34a',
                            }}
                          />
                          READY IN QUEUE
                        </span>
                      )}
                    </td>

                    <td style={{ padding: '12px 16px' }}>
                      {t.type === 'tld_zone' ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '3px 10px',
                            borderRadius: '9999px',
                            fontSize: '11px',
                            fontWeight: 700,
                            background: '#ecfdf5',
                            color: '#047857',
                            border: '1px solid #a7f3d0',
                          }}
                        >
                          <span
                            style={{
                              width: '6px',
                              height: '6px',
                              borderRadius: '50%',
                              background: '#10b981',
                              animation: 'pulse 1.2s infinite ease-in-out',
                            }}
                          />
                          TLD ZONE (24/7 STREAM)
                        </span>
                      ) : (
                        <Badge variant={t.type === 'subdomain' ? 'warning' : 'primary'}>
                          {t.type === 'subdomain' ? 'SUBDOMAIN' : 'ROOT DOMAIN'}
                        </Badge>
                      )}
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
              </motion.tbody>
            </AnimatePresence>
          </table>
        </div>
      </div>
    </Card>
  );
};

