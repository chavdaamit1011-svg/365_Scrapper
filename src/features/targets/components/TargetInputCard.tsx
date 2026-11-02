'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Globe, Plus, AlertCircle, CheckCircle2, Play, FileSpreadsheet } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TargetItem } from '../types/target.types';
import { cleanDomainString, isValidTarget, classifyTargetType } from '../utils/domainValidator';

interface TargetInputCardProps {
  onAddTargets: (targets: TargetItem[]) => void;
  existingTargets: TargetItem[];
  onAddAndStart?: (targets: TargetItem[]) => void;
  onOpenBulkModal?: () => void;
}

export const TargetInputCard: React.FC<TargetInputCardProps> = ({
  onAddTargets,
  existingTargets,
  onAddAndStart,
  onOpenBulkModal,
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
      {/* Header Row: Title & Bulk Upload Modal Button */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '12px',
          marginBottom: '14px',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <div
            style={{
              width: '34px',
              height: '34px',
              borderRadius: '8px',
              background: '#e0f2fe',
              color: '#0284c7',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
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

        {onOpenBulkModal && (
          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onOpenBulkModal}
              leftIcon={<FileSpreadsheet size={15} color="#10b981" />}
              style={{
                fontWeight: 600,
                borderColor: '#cbd5e1',
                background: '#ffffff',
              }}
            >
              Bulk Ingestion (CSV / Excel)
            </Button>
          </motion.div>
        )}
      </div>

      {/* Spacious Full-Width Search & Ingestion Input Row */}
      <form onSubmit={handleAdd}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
          <div style={{ flex: 1, minWidth: '280px', position: 'relative' }}>
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
                fontSize: '13.5px',
                padding: '11px 16px',
                width: '100%',
                borderRadius: '8px',
              }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
            <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <Button
                type="submit"
                variant="secondary"
                size="md"
                leftIcon={<Plus size={15} />}
                style={{ padding: '10px 18px', fontWeight: 600 }}
              >
                Add Target
              </Button>
            </motion.div>

            {onAddAndStart && (
              <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <Button
                  type="button"
                  variant="primary"
                  size="md"
                  onClick={handleAddAndStart}
                  leftIcon={<Play size={14} fill="currentColor" />}
                  style={{ padding: '10px 20px', fontWeight: 600 }}
                >
                  Add & Crawl Now
                </Button>
              </motion.div>
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
