'use client';

import React, { useState } from 'react';
import { Globe, Plus, AlertCircle, CheckCircle2, Play } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TargetItem } from '../types/target.types';
import { cleanDomainString, isValidTarget, classifyTargetType } from '../utils/domainValidator';

interface TargetInputCardProps {
  onAddTargets: (targets: TargetItem[]) => void;
  existingTargets: TargetItem[];
  onAddAndStart?: (targets: TargetItem[]) => void;
}

export const TargetInputCard: React.FC<TargetInputCardProps> = ({
  onAddTargets,
  existingTargets,
  onAddAndStart,
}) => {
  const [inputVal, setInputVal] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const existingSet = new Set(existingTargets.map((t) => t.domain.toLowerCase()));

  const parseInputTokens = (): TargetItem[] | null => {
    setError(null);
    setSuccess(null);

    if (!inputVal.trim()) {
      setError('Please enter at least one domain or subdomain.');
      return null;
    }

    const tokens = inputVal.split(/[\s,;]+/);
    const newItems: TargetItem[] = [];
    let duplicates = 0;
    let invalids = 0;

    for (const token of tokens) {
      if (!token) continue;
      const cleaned = cleanDomainString(token);
      if (!cleaned) continue;

      if (!isValidTarget(cleaned)) {
        invalids++;
        continue;
      }

      if (existingSet.has(cleaned) || newItems.some((n) => n.domain === cleaned)) {
        duplicates++;
        continue;
      }

      newItems.push({
        id: `tgt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        domain: cleaned,
        type: classifyTargetType(cleaned),
        source: 'manual',
        addedAt: new Date().toISOString(),
      });
    }

    if (newItems.length === 0) {
      if (duplicates > 0) {
        setError(`Target already exists in the queue (${duplicates} duplicate).`);
      } else if (invalids > 0) {
        setError('Invalid domain or subdomain syntax. (e.g. example.com, api.target.net)');
      }
      return null;
    }

    return newItems;
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const items = parseInputTokens();
    if (!items) return;

    onAddTargets(items);
    setInputVal('');
    setSuccess(
      `Added ${items.length} target${items.length > 1 ? 's' : ''} to search queue.`
    );
    setTimeout(() => setSuccess(null), 3000);
  };

  const handleAddAndStart = () => {
    const items = parseInputTokens();
    if (!items) return;

    setInputVal('');
    if (onAddAndStart) {
      onAddAndStart(items);
    } else {
      onAddTargets(items);
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
            background: '#e0f2fe',
            color: '#0284c7',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Globe size={18} />
        </div>
        <div>
          <h3 style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-main)', margin: 0 }}>
            Manual Target Scope Entry
          </h3>
          <span style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
            Enter single or multiple domains/subdomains separated by comma or space
          </span>
        </div>
      </div>

      <form onSubmit={handleAdd} style={{ marginTop: '14px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: '240px', position: 'relative' }}>
            <input
              type="text"
              placeholder="e.g. example.com, api.target.org, dev.portal.net"
              value={inputVal}
              onChange={(e) => {
                setInputVal(e.target.value);
                if (error) setError(null);
              }}
              className="spatial-input"
              style={{
                fontSize: '13px',
                padding: '10px 14px',
                width: '100%',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Button
              type="submit"
              variant="secondary"
              size="md"
              leftIcon={<Plus size={15} />}
            >
              Add Target
            </Button>

            {onAddAndStart && (
              <Button
                type="button"
                variant="primary"
                size="md"
                onClick={handleAddAndStart}
                leftIcon={<Play size={14} fill="currentColor" />}
              >
                Add & Crawl Now
              </Button>
            )}
          </div>
        </div>

        {/* Validation Error Message */}
        {error && (
          <div
            style={{
              marginTop: '10px',
              padding: '8px 12px',
              borderRadius: '6px',
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#b91c1c',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <AlertCircle size={14} />
            <span>{error}</span>
          </div>
        )}

        {/* Success Feedback */}
        {success && (
          <div
            style={{
              marginTop: '10px',
              padding: '8px 12px',
              borderRadius: '6px',
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              color: '#15803d',
              fontSize: '12px',
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            <CheckCircle2 size={14} />
            <span>{success}</span>
          </div>
        )}
      </form>
    </Card>
  );
};
