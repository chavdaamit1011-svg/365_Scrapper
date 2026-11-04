'use client';

import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Radar,
  Target,
  Search,
  Settings,
  ChevronLeft,
  ChevronRight,
  LogOut,
} from 'lucide-react';
import { UserSummary } from '@/types';
import { Badge } from '@/components/ui/Badge';

export type NavTab = 'targets' | 'dorking' | 'settings';

interface SpatialSidebarProps {
  activeTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  onLogout: () => void;
  currentUser: UserSummary | null;
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  targetsCount?: number;
}

export const SpatialSidebar: React.FC<SpatialSidebarProps> = ({
  activeTab,
  onTabChange,
  onLogout,
  currentUser,
  isCollapsed,
  setIsCollapsed,
  targetsCount = 0,
}) => {
  const navItems = [
    {
      id: 'targets' as NavTab,
      label: 'Target & Crawler',
      icon: <Target size={18} />,
      badge: targetsCount > 0 ? `${targetsCount} Scope` : 'Scope',
    },
    {
      id: 'dorking' as NavTab,
      label: 'Dorking Engine',
      icon: <Search size={18} />,
      badge: 'OSINT Recon',
    },
    {
      id: 'settings' as NavTab,
      label: 'Engine Settings',
      icon: <Settings size={18} />,
      badge: 'Port 3131',
    },
  ];

  return (
    <motion.aside
      initial={false}
      animate={{ width: isCollapsed ? 76 : 260 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      className="pro-card"
      style={{
        height: 'calc(100vh - 40px)',
        flexShrink: 0,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: isCollapsed ? '20px 10px' : '20px 14px',
        zIndex: 20,
        overflow: 'hidden',
      }}
    >
      {/* Top Header & Brand */}
      <div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: isCollapsed ? 'center' : 'space-between',
            marginBottom: '20px',
            paddingBottom: '14px',
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '8px',
                background: '#0284c7',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                flexShrink: 0,
              }}
            >
              <Radar size={19} strokeWidth={2.2} />
            </div>

            <AnimatePresence>
              {!isCollapsed && (
                <motion.div
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -6 }}
                  transition={{ duration: 0.18, ease: 'easeOut' }}
                  style={{ overflow: 'hidden', whiteSpace: 'nowrap' }}
                >
                  <h2
                    style={{
                      fontSize: '15px',
                      fontWeight: 700,
                      color: 'var(--text-main)',
                      letterSpacing: '-0.3px',
                      margin: 0,
                    }}
                  >
                    The Scrapper
                  </h2>
                  <span style={{ fontSize: '10.5px', color: 'var(--text-muted)' }}>
                    IP Intel Engine
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {!isCollapsed && (
            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 450, damping: 25 }}
              onClick={() => setIsCollapsed(true)}
              className="spatial-btn-secondary"
              style={{
                width: '26px',
                height: '26px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #e2e8f0',
                cursor: 'pointer',
                padding: 0,
              }}
              title="Collapse sidebar"
            >
              <ChevronLeft size={14} />
            </motion.button>
          )}
        </div>

        {isCollapsed && (
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 450, damping: 25 }}
              onClick={() => setIsCollapsed(false)}
              className="spatial-btn-secondary"
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                border: '1px solid #e2e8f0',
                cursor: 'pointer',
                padding: 0,
              }}
              title="Expand sidebar"
            >
              <ChevronRight size={14} />
            </motion.button>
          </div>
        )}

        {/* Navigation Items with Framer Motion layoutId */}
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '4px', position: 'relative' }}>
          {navItems.map((item) => {
            const isActive = activeTab === item.id;

            return (
              <motion.button
                key={item.id}
                type="button"
                whileHover={{ x: 2 }}
                whileTap={{ scale: 0.98 }}
                onClick={() => onTabChange(item.id)}
                style={{
                  position: 'relative',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '10px',
                  padding: isCollapsed ? '10px' : '9px 12px',
                  borderRadius: '8px',
                  border: 'none',
                  background: 'transparent',
                  color: isActive ? '#0284c7' : '#475569',
                  fontWeight: isActive ? 600 : 500,
                  fontSize: '12.5px',
                  justifyContent: isCollapsed ? 'center' : 'flex-start',
                  cursor: 'pointer',
                  width: '100%',
                  textAlign: 'left',
                  zIndex: 1,
                  outline: 'none',
                  transition: 'color 0.18s ease',
                }}
                title={isCollapsed ? item.label : undefined}
              >
                {isActive && (
                  <motion.div
                    layoutId="activeSidebarNavPill"
                    transition={{ type: 'spring', stiffness: 500, damping: 35 }}
                    style={{
                      position: 'absolute',
                      inset: 0,
                      background: '#f0f9ff',
                      borderRadius: '8px',
                      borderLeft: '3px solid #0284c7',
                      zIndex: -1,
                    }}
                  />
                )}
                <span style={{ display: 'flex', flexShrink: 0 }}>{item.icon}</span>

                {!isCollapsed && (
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      flex: 1,
                      overflow: 'hidden',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <span>{item.label}</span>
                    <span
                      style={{
                        fontSize: '9.5px',
                        padding: '1px 5px',
                        borderRadius: '4px',
                        background: isActive ? '#bae6fd' : '#f1f5f9',
                        color: isActive ? '#0369a1' : '#64748b',
                      }}
                    >
                      {item.badge}
                    </span>
                  </div>
                )}
              </motion.button>
            );
          })}
        </nav>
      </div>

      {/* Footer: User Identity & Sign Out */}
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: '14px' }}>
        {isCollapsed ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
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
                fontWeight: 700,
                fontSize: '12px',
              }}
              title={currentUser?.username}
            >
              {currentUser?.username.slice(0, 2).toUpperCase() || 'U'}
            </div>

            <motion.button
              type="button"
              whileHover={{ scale: 1.08 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: 'spring', stiffness: 450, damping: 25 }}
              onClick={onLogout}
              className="spatial-btn-secondary"
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                padding: 0,
                color: '#e11d48',
              }}
              title="Sign Out"
            >
              <LogOut size={14} />
            </motion.button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            {currentUser && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  padding: '6px 8px',
                  background: '#f8fafc',
                  borderRadius: '8px',
                  border: '1px solid #e2e8f0',
                }}
              >
                <div
                  style={{
                    width: '30px',
                    height: '30px',
                    borderRadius: '6px',
                    background: '#e0f2fe',
                    color: '#0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: '12px',
                    flexShrink: 0,
                  }}
                >
                  {currentUser.username.slice(0, 2).toUpperCase()}
                </div>
                <div style={{ overflow: 'hidden', flex: 1 }}>
                  <div
                    style={{
                      fontSize: '12px',
                      fontWeight: 700,
                      color: 'var(--text-main)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {currentUser.username}
                  </div>
                  <div
                    style={{
                      fontSize: '10.5px',
                      color: 'var(--text-muted)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {currentUser.email}
                  </div>
                </div>
                <Badge variant="primary">{currentUser.role}</Badge>
              </div>
            )}

            <motion.button
              type="button"
              whileHover={{ scale: 1.015 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 450, damping: 25 }}
              onClick={onLogout}
              className="spatial-btn-secondary"
              style={{
                width: '100%',
                padding: '7px 10px',
                borderRadius: '6px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '6px',
                fontSize: '12px',
                cursor: 'pointer',
                color: '#e11d48',
                border: '1px solid #fee2e2',
              }}
            >
              <LogOut size={13} /> Sign Out
            </motion.button>
          </div>
        )}
      </div>
    </motion.aside>
  );
};
