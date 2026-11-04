'use client';

import React from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  Ban,
  Trash2,
  Radar,
  Globe,
  Mail,
  Compass,
  CheckCircle2,
  Clock,
  Layers,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { CrawlerExecutionState, CrawlerStats } from '../types/crawler.types';

interface CrawlerControlBarProps {
  status: CrawlerExecutionState;
  stats: CrawlerStats;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onCancel: () => void;
  onClear: () => void;
  hasTargets: boolean;
  hasResults: boolean;
}

export const CrawlerControlBar: React.FC<CrawlerControlBarProps> = ({
  status,
  stats,
  onStart,
  onPause,
  onResume,
  onCancel,
  onClear,
  hasTargets,
  hasResults,
}) => {
  const formatTime = (totalSeconds: number) => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getStatusBadge = () => {
    switch (status) {
      case 'RUNNING':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              background: '#e0f2fe',
              color: '#0369a1',
              border: '1px solid #bae6fd',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#0284c7',
                animation: 'pulse 1.2s infinite ease-in-out',
              }}
            />
            {stats.cycleCount && stats.cycleCount > 1
              ? `LIVE CONTINUOUS RECON (CYCLE #${stats.cycleCount})`
              : 'CONTINUOUS CRAWLING ACTIVE'}
          </span>
        );
      case 'PAUSED':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              background: '#fef3c7',
              color: '#92400e',
              border: '1px solid #fde68a',
            }}
          >
            <Pause size={11} strokeWidth={2.5} />
            CRAWLER PAUSED
          </span>
        );
      case 'CANCELLED':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              background: '#ffe4e6',
              color: '#be123c',
              border: '1px solid #fecdd3',
            }}
          >
            <Ban size={11} strokeWidth={2.5} />
            CRAWL CANCELLED
          </span>
        );
      case 'COMPLETED':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              background: '#dcfce7',
              color: '#15803d',
              border: '1px solid #bbf7d0',
            }}
          >
            <CheckCircle2 size={11} strokeWidth={2.5} />
            CRAWL COMPLETED
          </span>
        );
      case 'IDLE':
      default:
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              padding: '4px 10px',
              borderRadius: '9999px',
              fontSize: '11px',
              fontWeight: 700,
              letterSpacing: '0.5px',
              background: '#f1f5f9',
              color: '#64748b',
              border: '1px solid #e2e8f0',
            }}
          >
            <span
              style={{
                width: '7px',
                height: '7px',
                borderRadius: '50%',
                background: '#94a3b8',
              }}
            />
            ENGINE READY (IDLE)
          </span>
        );
    }
  };

  return (
    <Card style={{ padding: '20px 24px' }}>
      {/* Top Header Row: Status, Title & Action Buttons */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '16px',
          paddingBottom: '16px',
          borderBottom: '1px solid #f1f5f9',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <div
            style={{
              width: '38px',
              height: '38px',
              borderRadius: '10px',
              background: 'linear-gradient(135deg, #0284c7, #0369a1)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              boxShadow: '0 2px 6px rgba(2, 132, 199, 0.25)',
              flexShrink: 0,
            }}
          >
            <Radar size={20} strokeWidth={2.2} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
              <h3 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-main)', margin: 0, letterSpacing: '-0.3px' }}>
                Crawler Engine Command Center
              </h3>
              {getStatusBadge()}
            </div>
            <p style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px', margin: 0 }}>
              Autonomous extractor for domain, subdomain, email, and country OSINT.
            </p>
          </div>
        </div>

        {/* Crawler Execution Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
          {/* Start or Resume */}
          {status === 'IDLE' || status === 'COMPLETED' || status === 'CANCELLED' ? (
            <Button
              variant="primary"
              size="sm"
              onClick={onStart}
              disabled={!hasTargets}
              leftIcon={<Play size={14} fill="currentColor" />}
              title={!hasTargets ? 'Add targets first to start' : 'Start crawling targets'}
            >
              Start Crawler
            </Button>
          ) : null}

          {/* Pause / Stop button */}
          {status === 'RUNNING' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onPause}
              leftIcon={<Pause size={14} fill="currentColor" />}
              style={{ borderColor: '#fde68a', color: '#92400e', background: '#fffbeb' }}
              title="Pause active crawl (queue domains remain waiting)"
            >
              Pause Crawler
            </Button>
          )}

          {/* Resume button */}
          {status === 'PAUSED' && (
            <Button
              variant="primary"
              size="sm"
              onClick={onResume}
              leftIcon={<RotateCcw size={14} />}
              title="Resume crawling active domain"
            >
              Resume Crawler
            </Button>
          )}

          {/* Cancel button */}
          {(status === 'RUNNING' || status === 'PAUSED') && (
            <Button
              variant="danger"
              size="sm"
              onClick={onCancel}
              leftIcon={<Ban size={14} />}
              title={hasTargets ? 'Cancel current domain and crawl next domain from queue' : 'Cancel active crawl'}
            >
              {hasTargets ? 'Cancel & Next Domain' : 'Cancel Crawl'}
            </Button>
          )}

          {/* Clear Scraped Data */}
          {hasResults && status !== 'RUNNING' && (
            <Button
              variant="secondary"
              size="sm"
              onClick={onClear}
              leftIcon={<Trash2 size={13} />}
              style={{ color: 'var(--text-muted)' }}
              title="Clear scraped results"
            >
              Clear Data
            </Button>
          )}
        </div>
      </div>

      {/* Progress & Live Telemetry Section */}
      <div style={{ marginTop: '16px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: '8px',
            fontSize: '12px',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
              {stats.progressPercent}% Completed
            </span>
            <span>•</span>
            <span>
              {stats.processedTargets} of {stats.totalTargets} targets processed
            </span>
            {stats.currentTargetName && (
              <>
                <span>•</span>
                <span style={{ color: '#0284c7', fontWeight: 600 }}>
                  Scanning: {stats.currentTargetName}
                </span>
              </>
            )}
            {stats.activeTargetPhase && (
              <span
                style={{
                  fontSize: '11px',
                  background: '#e0f2fe',
                  color: '#0369a1',
                  padding: '2px 8px',
                  borderRadius: '6px',
                  fontWeight: 600,
                  border: '1px solid #bae6fd',
                }}
              >
                {stats.activeTargetPhase}
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '11.5px' }}>
            <Clock size={12} />
            <span>Time Elapsed: {formatTime(stats.elapsedSeconds)}</span>
          </div>
        </div>

        {/* Progress Bar Container */}
        <div
          style={{
            width: '100%',
            height: '8px',
            background: '#e2e8f0',
            borderRadius: '9999px',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${stats.progressPercent}%`,
              height: '100%',
              background: status === 'CANCELLED'
                ? '#f43f5e'
                : status === 'COMPLETED'
                ? '#10b981'
                : 'linear-gradient(90deg, #0284c7, #38bdf8)',
              borderRadius: '9999px',
              transition: 'width 0.4s ease-in-out',
            }}
          />
        </div>
      </div>

      {/* Extracted Metrics Grid (Domain, Subdomain, Email, Country) */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
          gap: '12px',
          marginTop: '16px',
          paddingTop: '16px',
          borderTop: '1px solid #f1f5f9',
        }}
      >
        {/* Metric 1: Targets Scanned */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: '#f8fafc',
            border: '1px solid #f1f5f9',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              background: '#e0f2fe',
              color: '#0284c7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Layers size={16} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>
              Session Target Scope
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)' }}>
              {stats.processedTargets} / {stats.totalTargets}
            </div>
            <div style={{ fontSize: '10.5px', color: '#0284c7', marginTop: '1px' }}>
              {status === 'COMPLETED'
                ? 'All Targets Processed'
                : status === 'RUNNING'
                ? `${Math.max(0, stats.totalTargets - stats.processedTargets)} Remaining`
                : 'Ready in Queue'}
            </div>
          </div>
        </div>

        {/* Metric 2: Active Target Subdomains */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: '#f8fafc',
            border: '1px solid #f1f5f9',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              background: '#ede9fe',
              color: '#7c3aed',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Globe size={16} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>
              Active Target Subdomains
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#7c3aed' }}>
              {status === 'RUNNING' && (stats.activeTargetSubdomains === null || stats.activeTargetSubdomains === undefined)
                ? 'Discovering...'
                : stats.activeTargetSubdomains !== null && stats.activeTargetSubdomains !== undefined
                ? `${stats.activeTargetSubdomains} Found`
                : status === 'COMPLETED'
                ? `${stats.activeTargetSubdomains ?? 0} Discovered`
                : '-'}
            </div>
            <div
              style={{
                fontSize: '10.5px',
                color: 'var(--text-muted)',
                marginTop: '1px',
                maxWidth: '140px',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={stats.currentTargetName || 'Active Target'}
            >
              {stats.currentTargetName ? stats.currentTargetName : 'Scope Standby'}
            </div>
          </div>
        </div>

        {/* Metric 3: Active Target Emails */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: '#f8fafc',
            border: '1px solid #f1f5f9',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              background: '#fef3c7',
              color: '#d97706',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Mail size={16} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>
              Active Target Emails
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#d97706' }}>
              {status === 'RUNNING' && (stats.activeTargetEmails === null || stats.activeTargetEmails === undefined)
                ? 'Extracting...'
                : stats.activeTargetEmails !== null && stats.activeTargetEmails !== undefined
                ? `${stats.activeTargetEmails} Verified`
                : status === 'COMPLETED'
                ? `${stats.activeTargetEmails ?? 0} Verified`
                : '-'}
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '1px' }}>
              Legitimate verified
            </div>
          </div>
        </div>

        {/* Metric 4: Total Database Intelligence */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '10px 14px',
            borderRadius: '8px',
            background: '#f8fafc',
            border: '1px solid #f1f5f9',
          }}
        >
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '6px',
              background: '#dcfce7',
              color: '#15803d',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            <Compass size={16} />
          </div>
          <div>
            <div style={{ fontSize: '11px', color: 'var(--text-muted)', fontWeight: 500 }}>
              Database Total Intelligence
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#15803d' }}>
              {stats.databaseTotalSubdomains ?? stats.subdomainsFound} Subs • {stats.databaseTotalEmails ?? stats.emailsFound} Emails
            </div>
            <div style={{ fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '1px' }}>
              Across {stats.databaseTotalDomains ?? 1} Saved Domains
            </div>
          </div>
        </div>
      </div>
    </Card>
  );
};

