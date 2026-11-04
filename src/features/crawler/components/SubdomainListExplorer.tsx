'use client';

import React, { useState, useMemo } from 'react';
import {
  Search,
  Copy,
  Check,
  ExternalLink,
  Download,
  List,
  Grid,
  ChevronLeft,
  ChevronRight,
  Globe,
  Sparkles,
  AlertTriangle,
  CheckCircle2,
  X,
} from 'lucide-react';
import { SubdomainItemDetail } from '../types/crawler.types';

interface SubdomainListExplorerProps {
  subdomains: string[];
  domainName: string;
  subdomainDetails?: SubdomainItemDetail[];
}

export const SubdomainListExplorer: React.FC<SubdomainListExplorerProps> = ({
  subdomains,
  domainName,
  subdomainDetails = [],
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'table' | 'grid'>('table');
  const [sortBy, setSortBy] = useState<'az' | 'za' | 'shortest' | 'longest'>('az');
  const [levelFilter, setLevelFilter] = useState<'all' | 'level2' | 'multilevel'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'new' | 'active' | 'removed'>('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState<number>(50);
  const [copiedItem, setCopiedItem] = useState<string | null>(null);
  const [isCopiedAll, setIsCopiedAll] = useState(false);

  // Map each subdomain to its reconciliation status (NEW, ACTIVE, REMOVED)
  const statusMap = useMemo(() => {
    const map = new Map<string, 'NEW' | 'ACTIVE' | 'REMOVED'>();
    if (Array.isArray(subdomainDetails)) {
      for (const d of subdomainDetails) {
        if (d && d.subdomain) {
          map.set(d.subdomain.toLowerCase().trim(), d.status);
        }
      }
    }
    return map;
  }, [subdomainDetails]);

  // Count subdomains by lifecycle delta status
  const counts = useMemo(() => {
    let newCount = 0;
    let activeCount = 0;
    let removedCount = 0;
    for (const sub of subdomains) {
      const st = statusMap.get(sub.toLowerCase().trim()) || 'ACTIVE';
      if (st === 'NEW') newCount++;
      else if (st === 'REMOVED') removedCount++;
      else activeCount++;
    }
    return { newCount, activeCount, removedCount, total: subdomains.length };
  }, [subdomains, statusMap]);

  // Helper to determine depth
  const getSubdomainDepth = (sub: string, rootDomain: string) => {
    const cleanSub = sub.toLowerCase().trim();
    const cleanRoot = rootDomain.toLowerCase().trim();
    if (cleanSub === cleanRoot) return 0;
    if (cleanSub.endsWith(`.${cleanRoot}`)) {
      const prefix = cleanSub.slice(0, -(cleanRoot.length + 1));
      return prefix.split('.').filter(Boolean).length;
    }
    const parts = cleanSub.split('.').filter(Boolean);
    return Math.max(1, parts.length - 1);
  };

  // Filter & Sort
  const filteredSubdomains = useMemo(() => {
    let list = [...subdomains];

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter((sub) => sub.toLowerCase().includes(q));
    }

    // Status filter (All, Active, New, Removed)
    if (statusFilter !== 'all') {
      list = list.filter((sub) => {
        const st = (statusMap.get(sub.toLowerCase().trim()) || 'ACTIVE').toLowerCase();
        return st === statusFilter.toLowerCase();
      });
    }

    // Level filter
    if (levelFilter === 'level2') {
      list = list.filter((sub) => getSubdomainDepth(sub, domainName) === 1);
    } else if (levelFilter === 'multilevel') {
      list = list.filter((sub) => getSubdomainDepth(sub, domainName) > 1);
    }

    // Sort
    list.sort((a, b) => {
      if (sortBy === 'az') return a.localeCompare(b);
      if (sortBy === 'za') return b.localeCompare(a);
      if (sortBy === 'shortest') return a.length - b.length || a.localeCompare(b);
      if (sortBy === 'longest') return b.length - a.length || a.localeCompare(b);
      return 0;
    });

    return list;
  }, [subdomains, domainName, searchQuery, statusFilter, levelFilter, sortBy, statusMap]);

  // Reset page when filters change
  React.useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, statusFilter, levelFilter, sortBy, pageSize]);

  // Pagination calculations
  const totalItems = filteredSubdomains.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const startIndex = (currentPage - 1) * pageSize;
  const endIndex = Math.min(startIndex + pageSize, totalItems);
  const paginatedItems = useMemo(
    () => filteredSubdomains.slice(startIndex, endIndex),
    [filteredSubdomains, startIndex, endIndex]
  );

  const handleCopySingle = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedItem(text);
    setTimeout(() => setCopiedItem(null), 1600);
  };

  const handleCopyAll = () => {
    const text = filteredSubdomains.join('\n');
    navigator.clipboard.writeText(text);
    setIsCopiedAll(true);
    setTimeout(() => setIsCopiedAll(false), 2000);
  };

  const handleDownloadList = () => {
    const text = filteredSubdomains.join('\n');
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${domainName}_subdomains_${filteredSubdomains.length}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '10px',
        padding: '16px',
        boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
      }}
    >
      {/* 1. Header Toolbar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          paddingBottom: '12px',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              background: '#e0f2fe',
              color: '#0369a1',
              borderRadius: '6px',
              fontSize: '12.5px',
              fontWeight: 700,
            }}
          >
            <Globe size={13} />
            <span>{subdomains.length.toLocaleString()} Discovered Subdomains</span>
          </div>

          {searchQuery && (
            <span style={{ fontSize: '12px', color: '#64748b' }}>
              Found <strong>{totalItems.toLocaleString()}</strong> matches
            </span>
          )}
        </div>

        {/* Action Buttons: Copy All, Download TXT */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <button
            type="button"
            onClick={handleCopyAll}
            title="Copy all matching subdomains to clipboard"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 11px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              background: '#f8fafc',
              border: '1px solid #cbd5e1',
              color: '#334155',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            {isCopiedAll ? <Check size={13} color="#16a34a" /> : <Copy size={13} />}
            <span>{isCopiedAll ? 'Copied All!' : `Copy (${totalItems.toLocaleString()})`}</span>
          </button>

          <button
            type="button"
            onClick={handleDownloadList}
            title="Download subdomains as text file"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '5px',
              padding: '5px 11px',
              fontSize: '12px',
              fontWeight: 600,
              borderRadius: '6px',
              background: '#0284c7',
              border: '1px solid #0284c7',
              color: '#ffffff',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
          >
            <Download size={13} />
            <span>Export TXT</span>
          </button>
        </div>
      </div>

      {/* 2. Delta Lifecycle Status Filter Chips */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={() => setStatusFilter('all')}
          style={{
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '11.5px',
            fontWeight: 600,
            border: statusFilter === 'all' ? '1px solid #0284c7' : '1px solid #e2e8f0',
            background: statusFilter === 'all' ? '#e0f2fe' : '#f8fafc',
            color: statusFilter === 'all' ? '#0369a1' : '#64748b',
            cursor: 'pointer',
          }}
        >
          All ({counts.total})
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter('active')}
          style={{
            padding: '4px 10px',
            borderRadius: '6px',
            fontSize: '11.5px',
            fontWeight: 600,
            border: statusFilter === 'active' ? '1px solid #0284c7' : '1px solid #e2e8f0',
            background: statusFilter === 'active' ? '#e0f2fe' : '#f8fafc',
            color: statusFilter === 'active' ? '#0369a1' : '#64748b',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '4px',
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#0284c7' }} />
          Active ({counts.activeCount})
        </button>

        {counts.newCount > 0 && (
          <button
            type="button"
            onClick={() => setStatusFilter('new')}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontWeight: 700,
              border: statusFilter === 'new' ? '1px solid #16a34a' : '1px solid #bbf7d0',
              background: statusFilter === 'new' ? '#dcfce7' : '#f0fdf4',
              color: '#15803d',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Sparkles size={11} />
            Newly Added ({counts.newCount})
          </button>
        )}

        {counts.removedCount > 0 && (
          <button
            type="button"
            onClick={() => setStatusFilter('removed')}
            style={{
              padding: '4px 10px',
              borderRadius: '6px',
              fontSize: '11.5px',
              fontWeight: 700,
              border: statusFilter === 'removed' ? '1px solid #dc2626' : '1px solid #fecaca',
              background: statusFilter === 'removed' ? '#fee2e2' : '#fef2f2',
              color: '#b91c1c',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <AlertTriangle size={11} />
            Removed / Offline ({counts.removedCount})
          </button>
        )}
      </div>

      {/* 3. Controls & Search Row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '10px',
        }}
      >
        {/* Search Input */}
        <div style={{ position: 'relative', flex: '1 1 240px', maxWidth: '380px' }}>
          <Search
            size={14}
            color="#94a3b8"
            style={{ position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)' }}
          />
          <input
            type="text"
            placeholder={`Search ${domainName} subdomains...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              width: '100%',
              padding: '7px 28px 7px 30px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '12px',
              outline: 'none',
              background: '#ffffff',
            }}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              style={{
                position: 'absolute',
                right: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: '#94a3b8',
                padding: '2px',
              }}
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Filters and Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Level Filter */}
          <select
            value={levelFilter}
            onChange={(e) => setLevelFilter(e.target.value as any)}
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '12px',
              background: '#ffffff',
              color: '#334155',
            }}
          >
            <option value="all">All Levels</option>
            <option value="level2">Level 2 (e.g. state/dept)</option>
            <option value="multilevel">Multi-Level (3rd / 4th)</option>
          </select>

          {/* Sort Selector */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as any)}
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '12px',
              background: '#ffffff',
              color: '#334155',
            }}
          >
            <option value="az">Sort: A → Z</option>
            <option value="za">Sort: Z → A</option>
            <option value="shortest">Sort: Shortest first</option>
            <option value="longest">Sort: Longest first</option>
          </select>

          {/* Page Size */}
          <select
            value={pageSize}
            onChange={(e) => setPageSize(Number(e.target.value))}
            style={{
              padding: '6px 10px',
              borderRadius: '6px',
              border: '1px solid #cbd5e1',
              fontSize: '12px',
              background: '#ffffff',
              color: '#334155',
            }}
          >
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
            <option value={250}>250 / page</option>
          </select>

          {/* View Mode Toggle */}
          <div
            style={{
              display: 'inline-flex',
              background: '#f1f5f9',
              padding: '2px',
              borderRadius: '6px',
              border: '1px solid #e2e8f0',
            }}
          >
            <button
              type="button"
              onClick={() => setViewMode('table')}
              title="Organized List Table View"
              style={{
                border: 'none',
                background: viewMode === 'table' ? '#ffffff' : 'transparent',
                color: viewMode === 'table' ? '#0284c7' : '#64748b',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                boxShadow: viewMode === 'table' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              <List size={14} />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              title="Organized Grid View"
              style={{
                border: 'none',
                background: viewMode === 'grid' ? '#ffffff' : 'transparent',
                color: viewMode === 'grid' ? '#0284c7' : '#64748b',
                padding: '4px 8px',
                borderRadius: '4px',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                boxShadow: viewMode === 'grid' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
              }}
            >
              <Grid size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* 4. Main Data Presentation: Table or Structured Grid */}
      {paginatedItems.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '30px 10px', color: '#94a3b8', fontSize: '13px' }}>
          No subdomains match your criteria &quot;{searchQuery || statusFilter}&quot;.
          <button
            type="button"
            onClick={() => {
              setSearchQuery('');
              setStatusFilter('all');
              setLevelFilter('all');
            }}
            style={{
              marginLeft: '8px',
              color: '#0284c7',
              textDecoration: 'underline',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
            }}
          >
            Reset Filters
          </button>
        </div>
      ) : viewMode === 'table' ? (
        /* Organised Structured List Table */
        <div
          style={{
            border: '1px solid #f1f5f9',
            borderRadius: '8px',
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '8px 12px', width: '45px', fontWeight: 600 }}>#</th>
                <th style={{ padding: '8px 12px', fontWeight: 600 }}>Subdomain Hostname</th>
                <th style={{ padding: '8px 12px', width: '110px', fontWeight: 600 }}>Lifecycle Status</th>
                <th style={{ padding: '8px 12px', width: '90px', fontWeight: 600 }}>Depth Level</th>
                <th style={{ padding: '8px 12px', width: '130px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedItems.map((sub, index) => {
                const depth = getSubdomainDepth(sub, domainName);
                const itemIndex = startIndex + index + 1;
                const targetUrl = sub.startsWith('http://') || sub.startsWith('https://') ? sub : `https://${sub}`;
                const status = statusMap.get(sub.toLowerCase().trim()) || 'ACTIVE';
                const isRemoved = status === 'REMOVED';
                const isNew = status === 'NEW';

                return (
                  <tr
                    key={sub}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      background: isRemoved ? '#fff5f5' : isNew ? '#f0fdf4' : index % 2 === 0 ? '#ffffff' : '#fafafa',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = isRemoved ? '#fee2e2' : '#f0f9ff')}
                    onMouseLeave={(e) =>
                      (e.currentTarget.style.background = isRemoved
                        ? '#fff5f5'
                        : isNew
                        ? '#f0fdf4'
                        : index % 2 === 0
                        ? '#ffffff'
                        : '#fafafa')
                    }
                  >
                    {/* Index */}
                    <td style={{ padding: '8px 12px', color: '#94a3b8', fontFamily: 'monospace', fontSize: '11px' }}>
                      {itemIndex}
                    </td>

                    {/* Subdomain URL */}
                    <td style={{ padding: '8px 12px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <a
                          href={targetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title={isRemoved ? `${sub} (Offline / Removed)` : `Open ${targetUrl}`}
                          style={{
                            color: isRemoved ? '#94a3b8' : isNew ? '#15803d' : '#0369a1',
                            fontWeight: 600,
                            textDecoration: isRemoved ? 'line-through' : 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          {sub}
                          <ExternalLink size={11} color={isRemoved ? '#cbd5e1' : '#0284c7'} />
                        </a>
                      </div>
                    </td>

                    {/* Lifecycle Status Badge */}
                    <td style={{ padding: '8px 12px' }}>
                      {isNew ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '4px',
                            background: '#dcfce7',
                            color: '#15803d',
                            border: '1px solid #bbf7d0',
                          }}
                        >
                          <Sparkles size={10} /> NEW
                        </span>
                      ) : isRemoved ? (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '10.5px',
                            fontWeight: 700,
                            padding: '2px 7px',
                            borderRadius: '4px',
                            background: '#fee2e2',
                            color: '#b91c1c',
                            border: '1px solid #fecaca',
                          }}
                        >
                          <AlertTriangle size={10} /> REMOVED
                        </span>
                      ) : (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            fontSize: '10.5px',
                            fontWeight: 600,
                            padding: '2px 7px',
                            borderRadius: '4px',
                            background: '#e0f2fe',
                            color: '#0369a1',
                            border: '1px solid #bae6fd',
                          }}
                        >
                          ● ACTIVE
                        </span>
                      )}
                    </td>

                    {/* Depth */}
                    <td style={{ padding: '8px 12px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: 600,
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: depth > 1 ? '#fef3c7' : '#f1f5f9',
                          color: depth > 1 ? '#b45309' : '#475569',
                        }}
                      >
                        {depth > 1 ? `L${depth + 1} Multi` : 'L2 Direct'}
                      </span>
                    </td>

                    {/* Actions */}
                    <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '6px' }}>
                        <button
                          type="button"
                          onClick={() => handleCopySingle(sub)}
                          title="Copy subdomain"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            border: '1px solid #e2e8f0',
                            background: '#ffffff',
                            color: '#64748b',
                            fontSize: '11px',
                            cursor: 'pointer',
                          }}
                        >
                          {copiedItem === sub ? <Check size={11} color="#16a34a" /> : <Copy size={11} />}
                          <span>{copiedItem === sub ? 'Copied' : 'Copy'}</span>
                        </button>

                        <a
                          href={targetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Visit subdomain in browser"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '3px',
                            padding: '3px 8px',
                            borderRadius: '4px',
                            border: '1px solid #bae6fd',
                            background: '#e0f2fe',
                            color: '#0284c7',
                            fontSize: '11px',
                            fontWeight: 500,
                            textDecoration: 'none',
                          }}
                        >
                          <span>Visit</span>
                          <ExternalLink size={10} />
                        </a>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* Organised Structured 3-Column Grid */
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: '8px',
          }}
        >
          {paginatedItems.map((sub, index) => {
            const depth = getSubdomainDepth(sub, domainName);
            const itemIndex = startIndex + index + 1;
            const targetUrl = sub.startsWith('http://') || sub.startsWith('https://') ? sub : `https://${sub}`;
            const status = statusMap.get(sub.toLowerCase().trim()) || 'ACTIVE';
            const isRemoved = status === 'REMOVED';
            const isNew = status === 'NEW';

            return (
              <div
                key={sub}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '7px 10px',
                  borderRadius: '6px',
                  background: isRemoved ? '#fff5f5' : isNew ? '#f0fdf4' : '#f8fafc',
                  border: isRemoved ? '1px solid #fecaca' : isNew ? '1px solid #bbf7d0' : '1px solid #e2e8f0',
                  fontSize: '12px',
                  transition: 'border-color 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}>
                  <span style={{ fontSize: '10.5px', color: '#94a3b8', width: '24px', fontFamily: 'monospace' }}>
                    #{itemIndex}
                  </span>
                  <a
                    href={targetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={sub}
                    style={{
                      color: isRemoved ? '#94a3b8' : isNew ? '#15803d' : '#0369a1',
                      fontWeight: 600,
                      textDecoration: isRemoved ? 'line-through' : 'none',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {sub}
                  </a>
                  {isNew && (
                    <span style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 4px', background: '#dcfce7', color: '#15803d', borderRadius: '3px' }}>
                      NEW
                    </span>
                  )}
                  {isRemoved && (
                    <span style={{ fontSize: '9.5px', fontWeight: 700, padding: '1px 4px', background: '#fee2e2', color: '#b91c1c', borderRadius: '3px' }}>
                      REMOVED
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                  <button
                    type="button"
                    onClick={() => handleCopySingle(sub)}
                    title="Copy"
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: '2px',
                    }}
                  >
                    {copiedItem === sub ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                  </button>
                  <a
                    href={targetUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open in new tab"
                    style={{ color: '#0284c7' }}
                  >
                    <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 5. Smart Pagination Footer */}
      {totalPages > 1 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: '10px',
            paddingTop: '10px',
            borderTop: '1px solid #f1f5f9',
            fontSize: '12px',
            color: '#64748b',
          }}
        >
          <div>
            Showing <strong>{(startIndex + 1).toLocaleString()}</strong> –{' '}
            <strong>{endIndex.toLocaleString()}</strong> of{' '}
            <strong>{totalItems.toLocaleString()}</strong> subdomains
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                background: currentPage <= 1 ? '#f8fafc' : '#ffffff',
                color: currentPage <= 1 ? '#94a3b8' : '#334155',
                cursor: currentPage <= 1 ? 'not-allowed' : 'pointer',
              }}
            >
              <ChevronLeft size={13} />
              <span>Prev</span>
            </button>

            <span style={{ padding: '0 6px', fontWeight: 600, color: '#334155' }}>
              Page {currentPage} of {totalPages}
            </span>

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '2px',
                padding: '4px 8px',
                borderRadius: '4px',
                border: '1px solid #cbd5e1',
                background: currentPage >= totalPages ? '#f8fafc' : '#ffffff',
                color: currentPage >= totalPages ? '#94a3b8' : '#334155',
                cursor: currentPage >= totalPages ? 'not-allowed' : 'pointer',
              }}
            >
              <span>Next</span>
              <ChevronRight size={13} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
