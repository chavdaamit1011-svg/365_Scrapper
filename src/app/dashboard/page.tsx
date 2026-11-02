'use client';

export const dynamic = 'force-dynamic';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  UserPlus,
  RefreshCw,
  Database,
  ShieldCheck,
  Target,
  Zap,
  Layers,
  Play,
  CheckCircle2,
} from 'lucide-react';
import { SpatialSidebar, NavTab } from '@/features/dashboard/components/SpatialSidebar';
import { UserListTable } from '@/features/users/components/UserListTable';
import { CreateUserModal } from '@/features/users/components/CreateUserModal';
import { TargetInputCard } from '@/features/targets/components/TargetInputCard';
import { BulkUploadModal } from '@/features/targets/components/BulkUploadModal';
import { TargetQueueTable } from '@/features/targets/components/TargetQueueTable';
import { TargetItem } from '@/features/targets/types/target.types';
import { CrawlerControlBar } from '@/features/crawler/components/CrawlerControlBar';
import { ScrapedResultsTable } from '@/features/crawler/components/ScrapedResultsTable';
import { useCrawlerController } from '@/features/crawler/hooks/useCrawlerController';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { UserSummary } from '@/types';
import { getClientSession, clearClientSession } from '@/lib/session';

export default function DashboardPage() {
  const router = useRouter();
  const [currentUser, setCurrentUser] = useState<UserSummary | null>(null);
  const [users, setUsers] = useState<UserSummary[]>([]);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [isLoadingUsers, setIsLoadingUsers] = useState(true);
  const [activeTab, setActiveTab] = useState<NavTab>('targets');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Target Scope Ingestion State
  const [targets, setTargets] = useState<TargetItem[]>([]);
  const [isBulkModalOpen, setIsBulkModalOpen] = useState(false);

  // View mode switcher: 'results' (Scraped Intelligence) vs 'queue' (Target Scope Queue)
  const [dataViewMode, setDataViewMode] = useState<'results' | 'queue'>('results');

  const handleTargetCompleted = useCallback((targetId: string) => {
    setTargets((prev) => {
      const updated = prev.filter((t) => t.id !== targetId);
      try {
        localStorage.setItem('the_scrapper_targets_queue', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  }, []);

  // Crawler Controller Hook
  const crawler = useCrawlerController(targets, handleTargetCompleted);

  // Determine whether crawler is actively working or paused
  const isScrapingActive = crawler.status === 'RUNNING' || crawler.status === 'PAUSED';

  useEffect(() => {
    const session = getClientSession();
    if (!session) {
      router.replace('/login');
      return;
    }
    setCurrentUser(session);
    fetchUsers();

    // Hydrate targets from localStorage if available (with deduplication guard)
    try {
      const stored = localStorage.getItem('the_scrapper_targets_queue');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
          const seenIds = new Set<string>();
          const seenDomains = new Set<string>();
          const deduplicated: TargetItem[] = [];
          for (const item of parsed) {
            if (item && item.id && item.domain && !seenIds.has(item.id) && !seenDomains.has(item.domain)) {
              seenIds.add(item.id);
              seenDomains.add(item.domain);
              deduplicated.push(item);
            }
          }
          setTargets(deduplicated);
        }
      }
    } catch (e) {
      console.warn('Could not read cached target scope:', e);
    }
  }, [router]);

  // Automatically switch to 'results' tab when crawler starts
  useEffect(() => {
    if (crawler.status === 'RUNNING') {
      setDataViewMode('results');
    }
  }, [crawler.status]);

  // Automatically purge any targets that have already been scraped from the pending queue
  useEffect(() => {
    if (crawler.scrapedResults.length > 0) {
      const completedDomains = new Set(
        crawler.scrapedResults.map((r) => r.domain.toLowerCase().trim())
      );
      setTargets((prev) => {
        const pendingOnly = prev.filter((t) => !completedDomains.has(t.domain.toLowerCase().trim()));
        if (pendingOnly.length !== prev.length) {
          try {
            localStorage.setItem('the_scrapper_targets_queue', JSON.stringify(pendingOnly));
          } catch (e) {}
          return pendingOnly;
        }
        return prev;
      });
    }
  }, [crawler.scrapedResults]);

  const fetchUsers = async () => {
    try {
      setIsLoadingUsers(true);
      const res = await fetch('/api/users');
      const json = await res.json();
      if (json.success && Array.isArray(json.data)) {
        setUsers(json.data);
      }
    } catch (err) {
      console.error('Failed to load users:', err);
    } finally {
      setIsLoadingUsers(false);
    }
  };

  const handleLogout = () => {
    clearClientSession();
    router.replace('/login');
  };

  const handleUserCreated = (newUser: UserSummary) => {
    setUsers((prev) => [newUser, ...prev]);
  };

  const handleDeleteUser = async (userId: string) => {
    try {
      const res = await fetch(`/api/users/${userId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        setUsers((prev) => prev.filter((u) => u.id !== userId));
      } else {
        alert(json.message || 'Could not delete user.');
      }
    } catch (err) {
      alert('Network error while deleting user.');
    }
  };

  // Target Ingestion Handlers
  const handleAddTargets = (newItems: TargetItem[]) => {
    const completedDomains = new Set(
      crawler.scrapedResults.map((r) => r.domain.toLowerCase().trim())
    );

    setTargets((prev) => {
      const existingIds = new Set(prev.map((p) => p.id));
      const existingDomains = new Set(prev.map((p) => p.domain.toLowerCase()));
      const uniqueNew = newItems.filter(
        (item) =>
          !existingIds.has(item.id) &&
          !existingDomains.has(item.domain.toLowerCase()) &&
          !completedDomains.has(item.domain.toLowerCase().trim())
      );
      if (uniqueNew.length === 0) return prev;
      const updated = [...uniqueNew, ...prev];
      try {
        localStorage.setItem('the_scrapper_targets_queue', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const handleAddAndStart = (newItems: TargetItem[]) => {
    if (crawler.status === 'RUNNING' || crawler.status === 'PAUSED') {
      // Crawler is already working on another domain: append new target(s) to the pending Queue
      handleAddTargets(newItems);
      return;
    }

    // Crawler is IDLE: only queue the new item(s) to be crawled right now (do not keep old completed targets)
    setTargets(newItems);
    try {
      localStorage.setItem('the_scrapper_targets_queue', JSON.stringify(newItems));
    } catch (e) {}

    setTimeout(() => {
      crawler.startCrawler();
    }, 120);
  };

  const handleRemoveTarget = (id: string) => {
    setTargets((prev) => {
      const updated = prev.filter((t) => t.id !== id);
      try {
        localStorage.setItem('the_scrapper_targets_queue', JSON.stringify(updated));
      } catch (e) {}
      return updated;
    });
  };

  const handleClearTargets = () => {
    const confirmed = confirm('Are you sure you want to clear all loaded targets from queue?');
    if (!confirmed) return;
    setTargets([]);
    try {
      localStorage.removeItem('the_scrapper_targets_queue');
    } catch (e) {}
  };

  if (!currentUser) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: 32, height: 32, border: '3px solid #0284c7', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.6s linear infinite' }} />
        <style jsx>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        height: '100vh',
        maxHeight: '100vh',
        overflow: 'hidden',
        padding: '20px',
        gap: '20px',
        boxSizing: 'border-box',
      }}
    >
      {/* Sleek Collapsible Sidebar (100% Fixed, Never Scrolls with Page) */}
      <SpatialSidebar
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onLogout={handleLogout}
        currentUser={currentUser}
        isCollapsed={isSidebarCollapsed}
        setIsCollapsed={setIsSidebarCollapsed}
        targetsCount={targets.length}
      />

      {/* Main Content Area (Independent Smooth Scrolling) */}
      <main
        className="custom-main-scroll"
        style={{
          flex: 1,
          minWidth: 0,
          height: 'calc(100vh - 40px)',
          overflowY: 'auto',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          gap: '20px',
          paddingRight: '6px',
        }}
      >
        {/* Sleek Executive Top Header */}
        <Card style={{ padding: '16px 22px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                  <h1 style={{ fontSize: '16px', fontWeight: 700, color: 'var(--text-main)', margin: 0, letterSpacing: '-0.3px' }}>
                    Autonomous OSINT & Web Intelligence
                  </h1>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#0369a1',
                      background: '#e0f2fe',
                      padding: '2px 8px',
                      borderRadius: '9999px',
                      border: '1px solid #bae6fd',
                    }}
                  >
                    <span className="pulse-dot" style={{ width: '6px', height: '6px' }} />
                    Live Engine
                  </span>
                </div>
                <p style={{ fontSize: '12px', color: 'var(--text-muted)', margin: 0, marginTop: '2px' }}>
                  Domain scope ingestion, certificate recon, deep web crawling & verified contact extraction.
                </p>
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '12px',
                  fontWeight: 600,
                  color: '#15803d',
                  background: '#f0fdf4',
                  padding: '6px 12px',
                  borderRadius: '8px',
                  border: '1px solid #bbf7d0',
                }}
              >
                <Database size={13} color="#15803d" />
                <span>MongoDB: the_scraper</span>
              </div>

              <Button
                variant="secondary"
                size="sm"
                onClick={fetchUsers}
                isLoading={isLoadingUsers}
                leftIcon={<RefreshCw size={13} />}
                title="Sync database and users"
              >
                Sync Database
              </Button>
            </div>
          </div>
        </Card>

        {/* Tab 1: Target Ingestion & Autonomous Crawler Engine */}
        {activeTab === 'targets' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Top Row: Full-Width Manual Target Scope Entry with In-Card Bulk Modal Button */}
            <TargetInputCard
              onAddTargets={handleAddTargets}
              existingTargets={targets}
              onAddAndStart={handleAddAndStart}
              onOpenBulkModal={() => setIsBulkModalOpen(true)}
            />

            {/* Bulk Upload Modal Dialog */}
            <BulkUploadModal
              isOpen={isBulkModalOpen}
              onClose={() => setIsBulkModalOpen(false)}
              onAddTargets={handleAddTargets}
              existingTargets={targets}
            />

            {/* Middle: Crawler Engine Command Center - ONLY SHOWN WHEN SCRAPING IS ACTIVE */}
            <AnimatePresence>
              {isScrapingActive && (
                <motion.div
                  initial={{ opacity: 0, height: 0, scale: 0.98 }}
                  animate={{ opacity: 1, height: 'auto', scale: 1 }}
                  exit={{ opacity: 0, height: 0, scale: 0.98 }}
                  transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
                  style={{ overflow: 'hidden' }}
                >
                  <CrawlerControlBar
                    status={crawler.status}
                    stats={crawler.stats}
                    onStart={crawler.startCrawler}
                    onPause={crawler.pauseCrawler}
                    onResume={crawler.resumeCrawler}
                    onCancel={crawler.cancelCrawler}
                    onClear={crawler.clearResults}
                    hasTargets={targets.length > 0}
                    hasResults={crawler.scrapedResults.length > 0}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Bottom Section Switcher: Scraped Intelligence Stream vs Target Queue Scope */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px' }}>
              <div
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  background: '#f1f5f9',
                  padding: '4px',
                  borderRadius: '10px',
                  gap: '4px',
                  border: '1px solid #e2e8f0',
                  position: 'relative',
                }}
              >
                <button
                  type="button"
                  onClick={() => setDataViewMode('results')}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 18px',
                    borderRadius: '7px',
                    fontSize: '13px',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    background: 'transparent',
                    color: dataViewMode === 'results' ? '#0284c7' : '#64748b',
                    outline: 'none',
                    zIndex: 1,
                    transition: 'color 0.2s ease',
                  }}
                >
                  {dataViewMode === 'results' && (
                    <motion.div
                      layoutId="activeViewTabPill"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: '#ffffff',
                        borderRadius: '7px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
                        zIndex: -1,
                      }}
                    />
                  )}
                  <Zap size={15} color={dataViewMode === 'results' ? '#0284c7' : '#64748b'} />
                  <span>Scraped Intelligence ({crawler.scrapedResults.length})</span>
                </button>

                <button
                  type="button"
                  onClick={() => setDataViewMode('queue')}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    padding: '8px 18px',
                    borderRadius: '7px',
                    fontSize: '13px',
                    fontWeight: 600,
                    border: 'none',
                    cursor: 'pointer',
                    background: 'transparent',
                    color: dataViewMode === 'queue' ? '#0284c7' : '#64748b',
                    outline: 'none',
                    zIndex: 1,
                    transition: 'color 0.2s ease',
                  }}
                >
                  {dataViewMode === 'queue' && (
                    <motion.div
                      layoutId="activeViewTabPill"
                      transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        background: '#ffffff',
                        borderRadius: '7px',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
                        zIndex: -1,
                      }}
                    />
                  )}
                  <Layers size={15} color={dataViewMode === 'queue' ? '#0284c7' : '#64748b'} />
                  <span>Target Scope Queue ({targets.length})</span>
                </button>
              </div>

              {/* Start Crawler Trigger & Status Pill */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                {crawler.status === 'COMPLETED' && (
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: '#15803d',
                      background: '#dcfce7',
                      padding: '6px 12px',
                      borderRadius: '8px',
                      border: '1px solid #bbf7d0',
                    }}
                  >
                    <CheckCircle2 size={13} strokeWidth={2.5} />
                    Crawl Completed ({crawler.stats.processedTargets} targets)
                  </span>
                )}

                {!isScrapingActive && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={crawler.startCrawler}
                    disabled={targets.length === 0}
                    leftIcon={<Play size={14} fill="currentColor" />}
                  >
                    Start Crawler ({targets.length} Scope)
                  </Button>
                )}
              </div>
            </div>

            {/* View Mode 1: Scraped Intelligence Table (Domain, Subdomain, Email, Country) */}
            {dataViewMode === 'results' && (
              <ScrapedResultsTable
                records={crawler.scrapedResults}
                isCrawling={crawler.status === 'RUNNING'}
                onClearResults={crawler.clearResults}
              />
            )}

            {/* View Mode 2: Ingested Target Queue Table */}
            {dataViewMode === 'queue' && (
              <TargetQueueTable
                targets={targets}
                onRemoveTarget={handleRemoveTarget}
                onClearAll={handleClearTargets}
                onStartCrawler={crawler.startCrawler}
                isCrawling={isScrapingActive}
              />
            )}
          </div>
        )}

        {/* Tab 2: Authorized System Operators (IAM) */}
        {activeTab === 'settings' && (
          <div>
            <Card style={{ padding: '24px' }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  flexWrap: 'wrap',
                  gap: '14px',
                  marginBottom: '20px',
                  paddingBottom: '16px',
                  borderBottom: '1px solid #f1f5f9',
                }}
              >
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-main)', letterSpacing: '-0.3px', margin: 0 }}>
                    Authorized System Operators (IAM)
                  </h2>
                  <p style={{ fontSize: '12.5px', color: 'var(--text-muted)', marginTop: '4px', margin: 0 }}>
                    Manage operator credentials and permissions for The Scrapper engine.
                  </p>
                </div>

                <Button
                  variant="primary"
                  size="md"
                  onClick={() => setIsCreateModalOpen(true)}
                  leftIcon={<UserPlus size={15} />}
                >
                  + Create New User
                </Button>
              </div>

              {/* Real Operators Table */}
              <UserListTable
                users={users}
                onDeleteUser={handleDeleteUser}
                currentUserId={currentUser.id}
              />
            </Card>
          </div>
        )}
      </main>

      {/* Modal for Creating New Operator with Strict Validations */}
      <CreateUserModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        onUserCreated={handleUserCreated}
      />
    </div>
  );
}
