'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Search,
  Play,
  Pause,
  Square,
  RotateCcw,
  RefreshCw,
  Globe,
  Server,
  Layers,
  CheckCircle2,
  AlertTriangle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Terminal,
  Filter,
  Eye,
  Activity,
  Copy,
  Check,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import {
  DorkingJob,
  DorkingRecord,
  DorkingOverviewStats,
} from '@/modules/dorking/types/dorking.types';

export const DorkingDashboard: React.FC = () => {
  // Input State
  const [targetDomain, setTargetDomain] = useState('');
  const [customQueriesInput, setCustomQueriesInput] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<string[]>([
    'Google',
    'Bing',
    'SerpApi',
    'SearXNG',
    'MockDev',
  ]);
  const [includeInUrlKeywords, setIncludeInUrlKeywords] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  // Data State
  const [activeJob, setActiveJob] = useState<DorkingJob | null>(null);
  const [allJobs, setAllJobs] = useState<DorkingJob[]>([]);
  const [records, setRecords] = useState<DorkingRecord[]>([]);
  const [stats, setStats] = useState<DorkingOverviewStats | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(false);

  // Filters State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterDomain, setFilterDomain] = useState('ALL');
  const [filterProvider, setFilterProvider] = useState('ALL');
  const [filterDnsStatus, setFilterDnsStatus] = useState('ALL');

  // UI state
  const [isLogExpanded, setIsLogExpanded] = useState(false);
  const [copiedHost, setCopiedHost] = useState<string | null>(null);

  // Available Providers
  const providerOptions = ['Google', 'Bing', 'SerpApi', 'SearXNG', 'MockDev'];

  const toggleProvider = (name: string) => {
    setSelectedProviders((prev) =>
      prev.includes(name) ? prev.filter((p) => p !== name) : [...prev, name]
    );
  };

  // Fetch initial data & stats
  const fetchData = useCallback(async () => {
    try {
      setIsLoadingData(true);

      const [jobsRes, recsRes, statsRes] = await Promise.all([
        fetch('/api/dorking/jobs'),
        fetch('/api/dorking/results'),
        fetch('/api/dorking/stats'),
      ]);

      const jobsData = await jobsRes.json();
      const recsData = await recsRes.json();
      const statsData = await statsRes.json();

      if (jobsData.success && Array.isArray(jobsData.jobs)) {
        setAllJobs(jobsData.jobs);
        const running = jobsData.jobs.find(
          (j: DorkingJob) => j.status === 'RUNNING' || j.status === 'PAUSED'
        );
        if (running) {
          setActiveJob(running);
        } else if (jobsData.jobs.length > 0 && !activeJob) {
          setActiveJob(jobsData.jobs[0]);
        }
      }

      if (recsData.success && Array.isArray(recsData.records)) {
        setRecords(recsData.records);
      }

      if (statsData.success && statsData.stats) {
        setStats(statsData.stats);
      }
    } catch (err) {
      console.warn('Error fetching dorking data:', err);
    } finally {
      setIsLoadingData(false);
    }
  }, [activeJob]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Polling when active job is running
  useEffect(() => {
    if (!activeJob || (activeJob.status !== 'RUNNING' && activeJob.status !== 'PAUSED')) {
      return;
    }

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/dorking/jobs/${activeJob.id}`);
        const data = await res.json();
        if (data.success && data.job) {
          setActiveJob(data.job);
          if (data.job.status === 'COMPLETED' || data.job.status === 'STOPPED') {
            fetchData();
          }
        }
      } catch (e) {}
    }, 2000);

    return () => clearInterval(interval);
  }, [activeJob, fetchData]);

  // Start new Dorking job
  const handleStartJob = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetDomain.trim()) return;

    try {
      setIsStarting(true);
      const customQueries = customQueriesInput
        .split('\n')
        .map((q) => q.trim())
        .filter(Boolean);

      const res = await fetch('/api/dorking/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          domain: targetDomain.trim(),
          customQueries: customQueries.length > 0 ? customQueries : undefined,
          providers: selectedProviders.length > 0 ? selectedProviders : undefined,
          includeInUrlKeywords,
        }),
      });

      const data = await res.json();
      if (data.success && data.job) {
        setActiveJob(data.job);
        setAllJobs((prev) => [data.job, ...prev]);
        setTargetDomain('');
        setCustomQueriesInput('');
      } else {
        alert(data.error || 'Failed to start Dorking job');
      }
    } catch (err: any) {
      alert(`Error starting job: ${err?.message || err}`);
    } finally {
      setIsStarting(false);
    }
  };

  // Job Controls (Pause, Resume, Stop, Retry)
  const handleControlAction = async (action: 'pause' | 'resume' | 'stop' | 'retry') => {
    if (!activeJob) return;
    try {
      const res = await fetch(`/api/dorking/jobs/${activeJob.id}/control`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (data.success) {
        fetchData();
      }
    } catch (e) {
      console.warn(`Failed to execute control action '${action}':`, e);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedHost(text);
    setTimeout(() => setCopiedHost(null), 1800);
  };

  // Unique domains list for filter dropdown
  const domainFilterOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of records) {
      if (r.rootDomain) set.add(r.rootDomain);
    }
    return Array.from(set).sort();
  }, [records]);

  // Filtered records
  const filteredRecords = useMemo(() => {
    return records.filter((r) => {
      if (searchTerm && !r.hostname.toLowerCase().includes(searchTerm.toLowerCase())) {
        return false;
      }
      if (filterDomain !== 'ALL' && r.rootDomain !== filterDomain) {
        return false;
      }
      if (filterProvider !== 'ALL' && r.searchProvider.toLowerCase() !== filterProvider.toLowerCase()) {
        return false;
      }
      if (filterDnsStatus !== 'ALL' && r.dnsStatus !== filterDnsStatus) {
        return false;
      }
      return true;
    });
  }, [records, searchTerm, filterDomain, filterProvider, filterDnsStatus]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* 1. Header & Configuration Card */}
      <Card style={{ padding: '22px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div
                style={{
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  background: '#0284c7',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#ffffff',
                }}
              >
                <Search size={18} />
              </div>
              <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
                Automated Search Engine Dorking Engine
              </h2>
            </div>
            <p style={{ fontSize: '13px', color: 'var(--text-muted)', marginTop: '4px', margin: 0 }}>
              Discover deep multi-level subdomains, unlinked assets & public hostnames using advanced search queries.
            </p>
          </div>

          <Button
            variant="secondary"
            size="sm"
            onClick={fetchData}
            isLoading={isLoadingData}
            leftIcon={<RefreshCw size={13} />}
          >
            Refresh Data
          </Button>
        </div>

        {/* Input Form */}
        <form onSubmit={handleStartJob} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 320px' }}>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Target Domain Scope <span style={{ color: '#ef4444' }}>*</span>
              </label>
              <input
                type="text"
                placeholder="e.g. gov.in, digitalgujarat.gov.in, or target.com"
                value={targetDomain}
                onChange={(e) => setTargetDomain(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: '8px',
                  border: '1px solid #cbd5e1',
                  fontSize: '13px',
                  outline: 'none',
                  background: '#ffffff',
                }}
                required
              />
            </div>

            <div style={{ flex: '1 1 300px' }}>
              <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
                Search Providers (Select 1 or more)
              </label>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                {providerOptions.map((provider) => {
                  const isChecked = selectedProviders.includes(provider);
                  return (
                    <button
                      key={provider}
                      type="button"
                      onClick={() => toggleProvider(provider)}
                      style={{
                        padding: '6px 12px',
                        borderRadius: '6px',
                        fontSize: '12px',
                        fontWeight: 600,
                        border: isChecked ? '1px solid #0284c7' : '1px solid #e2e8f0',
                        background: isChecked ? '#e0f2fe' : '#f8fafc',
                        color: isChecked ? '#0369a1' : '#64748b',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      {isChecked && <Check size={12} />}
                      {provider}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          <div>
            <label style={{ display: 'block', fontSize: '12.5px', fontWeight: 600, color: 'var(--text-main)', marginBottom: '6px' }}>
              Custom Dork Queries (Optional, 1 per line)
            </label>
            <textarea
              placeholder={`site:example.com inurl:portal\nsite:*.example.com inurl:staging\nsite:example.com -www`}
              value={customQueriesInput}
              onChange={(e) => setCustomQueriesInput(e.target.value)}
              rows={2}
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: '8px',
                border: '1px solid #cbd5e1',
                fontSize: '12.5px',
                fontFamily: 'monospace',
                outline: 'none',
                resize: 'vertical',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '12.5px', color: '#475569' }}>
              <input
                type="checkbox"
                checked={includeInUrlKeywords}
                onChange={(e) => setIncludeInUrlKeywords(e.target.checked)}
                style={{ width: '15px', height: '15px', accentColor: '#0284c7' }}
              />
              Auto-generate keywords (api, portal, admin, auth, dev, staging, mail, vpn, test)
            </label>

            <Button
              type="submit"
              variant="primary"
              size="md"
              isLoading={isStarting}
              leftIcon={<Play size={14} />}
            >
              Start Dorking Engine
            </Button>
          </div>
        </form>
      </Card>

      {/* 2. Live Job Progress Bar & Control Banner */}
      {activeJob && (
        <Card
          style={{
            padding: '18px 22px',
            borderLeft: `5px solid ${
              activeJob.status === 'RUNNING'
                ? '#0284c7'
                : activeJob.status === 'PAUSED'
                ? '#f59e0b'
                : activeJob.status === 'COMPLETED'
                ? '#10b981'
                : '#ef4444'
            }`,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px', marginBottom: '14px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)' }}>
                  Job Target: {activeJob.domain}
                </span>
                <Badge
                  variant={
                    activeJob.status === 'RUNNING'
                      ? 'primary'
                      : activeJob.status === 'PAUSED'
                      ? 'warning'
                      : activeJob.status === 'COMPLETED'
                      ? 'success'
                      : 'danger'
                  }
                >
                  {activeJob.status}
                </Badge>
                <span style={{ fontSize: '12px', color: '#64748b' }}>
                  ID: {activeJob.id}
                </span>
              </div>
              <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, marginTop: '2px' }}>
                Providers: {activeJob.providersUsed.join(', ')} | Queries: {activeJob.completedQueries} / {activeJob.totalQueries}
              </p>
            </div>

            {/* Control Buttons */}
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              {activeJob.status === 'RUNNING' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleControlAction('pause')}
                  leftIcon={<Pause size={13} />}
                >
                  Pause
                </Button>
              )}
              {activeJob.status === 'PAUSED' && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleControlAction('resume')}
                  leftIcon={<Play size={13} />}
                >
                  Resume
                </Button>
              )}
              {(activeJob.status === 'RUNNING' || activeJob.status === 'PAUSED') && (
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleControlAction('stop')}
                  leftIcon={<Square size={13} />}
                >
                  Stop
                </Button>
              )}
              {activeJob.failedQueries > 0 && activeJob.status !== 'RUNNING' && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleControlAction('retry')}
                  leftIcon={<RotateCcw size={13} />}
                >
                  Retry Failed ({activeJob.failedQueries})
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setIsLogExpanded(!isLogExpanded)}
                leftIcon={<Terminal size={13} />}
              >
                {isLogExpanded ? 'Hide Logs' : 'View Logs'}
              </Button>
            </div>
          </div>

          {/* Progress Bar */}
          <div style={{ width: '100%', height: '7px', background: '#e2e8f0', borderRadius: '4px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${activeJob.totalQueries > 0 ? (activeJob.completedQueries / activeJob.totalQueries) * 100 : 0}%`,
                height: '100%',
                background: '#0284c7',
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          {/* Collapsible Execution Logs */}
          <AnimatePresence>
            {isLogExpanded && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                style={{
                  marginTop: '14px',
                  background: '#0f172a',
                  color: '#e2e8f0',
                  padding: '12px',
                  borderRadius: '8px',
                  fontFamily: 'monospace',
                  fontSize: '11.5px',
                  maxHeight: '220px',
                  overflowY: 'auto',
                }}
              >
                {activeJob.logs && activeJob.logs.length > 0 ? (
                  activeJob.logs.map((log, idx) => (
                    <div key={idx} style={{ padding: '2px 0', borderBottom: '1px solid #1e293b' }}>
                      {log}
                    </div>
                  ))
                ) : (
                  <div>No logs recorded yet.</div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </Card>
      )}

      {/* 3. Overview Statistics Metric Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
        <Card style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Total Queries</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#0f172a', marginTop: '4px' }}>
            {stats?.totalQueriesGenerated || 0}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
            Failed: {stats?.failedQueriesCount || 0}
          </div>
        </Card>

        <Card style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Search Results Hits</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#0284c7', marginTop: '4px' }}>
            {stats?.totalResultsCollected || 0}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
            Ignored Dups: {stats?.duplicatesIgnored || 0}
          </div>
        </Card>

        <Card style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>Unique Subdomains</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#10b981', marginTop: '4px' }}>
            {stats?.uniqueSubdomainsDiscovered || 0}
          </div>
          <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>
            Across {stats?.uniqueDomainsDiscovered || 0} root scopes
          </div>
        </Card>

        <Card style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>DNS Resolved</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#059669', marginTop: '4px' }}>
            {stats?.dnsResolvedCount || 0}
          </div>
          <div style={{ fontSize: '11px', color: '#16a34a', marginTop: '2px' }}>
            Live A / AAAA / CNAME
          </div>
        </Card>

        <Card style={{ padding: '16px' }}>
          <div style={{ fontSize: '12px', color: '#64748b', fontWeight: 600 }}>DNS Unresolved</div>
          <div style={{ fontSize: '24px', fontWeight: 700, color: '#d97706', marginTop: '4px' }}>
            {stats?.unresolvedCount || 0}
          </div>
          <div style={{ fontSize: '11px', color: '#b45309', marginTop: '2px' }}>
            Preserved in DB
          </div>
        </Card>
      </div>

      {/* 4. Filter Toolbar & Discoveries Table */}
      <Card style={{ padding: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px', flexWrap: 'wrap', gap: '12px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Globe size={18} color="#0284c7" />
            <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
              Discovered Hostnames & Subdomains ({filteredRecords.length})
            </h3>
          </div>

          {/* Filter Bar */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center' }}>
            {/* Search Filter */}
            <input
              type="text"
              placeholder="Search hostname..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                width: '160px',
              }}
            />

            {/* Target Domain Filter */}
            <select
              value={filterDomain}
              onChange={(e) => setFilterDomain(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                background: '#ffffff',
              }}
            >
              <option value="ALL">All Domains</option>
              {domainFilterOptions.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>

            {/* Provider Filter */}
            <select
              value={filterProvider}
              onChange={(e) => setFilterProvider(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                background: '#ffffff',
              }}
            >
              <option value="ALL">All Providers</option>
              {providerOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>

            {/* DNS Status Filter */}
            <select
              value={filterDnsStatus}
              onChange={(e) => setFilterDnsStatus(e.target.value)}
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                border: '1px solid #cbd5e1',
                fontSize: '12px',
                background: '#ffffff',
              }}
            >
              <option value="ALL">All DNS Statuses</option>
              <option value="RESOLVED">Resolved Only</option>
              <option value="CNAME_ONLY">CNAME Only</option>
              <option value="UNRESOLVED">Unresolved Only</option>
            </select>
          </div>
        </div>

        {/* Discoveries Table */}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '12.5px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0', color: '#475569' }}>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Hostname</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Root Domain</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Level</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>DNS Status</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>IP / CNAME</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Provider</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>Discovered Query</th>
                <th style={{ padding: '10px 12px', fontWeight: 600 }}>First Seen</th>
              </tr>
            </thead>
            <tbody>
              {filteredRecords.length > 0 ? (
                filteredRecords.map((r) => (
                  <tr
                    key={r.id}
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background 0.15s ease',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                    onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                  >
                    {/* Hostname with Link and Copy */}
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: '#0f172a' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <a
                          href={`https://${r.hostname}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            color: '#0284c7',
                            textDecoration: 'none',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                          }}
                        >
                          {r.hostname}
                          <ExternalLink size={12} color="#94a3b8" />
                        </a>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(r.hostname)}
                          title="Copy hostname"
                          style={{
                            border: 'none',
                            background: 'transparent',
                            cursor: 'pointer',
                            padding: '2px',
                            color: '#94a3b8',
                          }}
                        >
                          {copiedHost === r.hostname ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                        </button>
                      </div>
                    </td>

                    {/* Root Domain */}
                    <td style={{ padding: '10px 12px', color: '#64748b' }}>
                      {r.rootDomain}
                    </td>

                    {/* Subdomain Level */}
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          background: '#f1f5f9',
                          color: '#475569',
                          fontWeight: 600,
                        }}
                      >
                        {r.subdomainLevel > 0 ? `L${r.subdomainLevel}` : 'Root'}
                      </span>
                    </td>

                    {/* DNS Status Badge */}
                    <td style={{ padding: '10px 12px' }}>
                      {r.dnsStatus === 'RESOLVED' && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            background: '#dcfce7',
                            color: '#15803d',
                          }}
                        >
                          <CheckCircle2 size={11} /> RESOLVED
                        </span>
                      )}
                      {r.dnsStatus === 'CNAME_ONLY' && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            background: '#e0f2fe',
                            color: '#0369a1',
                          }}
                        >
                          CNAME ONLY
                        </span>
                      )}
                      {r.dnsStatus === 'UNRESOLVED' && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontSize: '11px',
                            fontWeight: 600,
                            padding: '2px 8px',
                            borderRadius: '9999px',
                            background: '#fef3c7',
                            color: '#b45309',
                          }}
                        >
                          <AlertTriangle size={11} /> UNRESOLVED
                        </span>
                      )}
                    </td>

                    {/* IP Addresses / CNAME target */}
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '11px', color: '#475569' }}>
                      {r.ipAddresses && r.ipAddresses.length > 0
                        ? r.ipAddresses[0] + (r.ipAddresses.length > 1 ? ` (+${r.ipAddresses.length - 1})` : '')
                        : r.cnames && r.cnames.length > 0
                        ? r.cnames[0]
                        : '—'}
                    </td>

                    {/* Provider */}
                    <td style={{ padding: '10px 12px' }}>
                      <span
                        style={{
                          fontSize: '11px',
                          padding: '2px 7px',
                          borderRadius: '4px',
                          background: '#f8fafc',
                          border: '1px solid #e2e8f0',
                          fontWeight: 600,
                          color: '#334155',
                        }}
                      >
                        {r.searchProvider}
                      </span>
                    </td>

                    {/* Query */}
                    <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontSize: '11px', color: '#64748b' }}>
                      {r.discoveredByQuery}
                    </td>

                    {/* First Seen */}
                    <td style={{ padding: '10px 12px', fontSize: '11px', color: '#94a3b8' }}>
                      {r.firstSeen ? new Date(r.firstSeen).toLocaleDateString() : '—'}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={8} style={{ padding: '30px', textAlign: 'center', color: '#94a3b8' }}>
                    {isLoadingData ? 'Loading discovered hostnames...' : 'No hostnames discovered matching criteria.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};
