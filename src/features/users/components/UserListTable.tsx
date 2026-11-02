'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Trash2, Shield, Search, User, Phone, Mail, Calendar } from 'lucide-react';
import { UserSummary } from '@/types';
import { Badge } from '@/components/ui/Badge';
import { Input } from '@/components/ui/Input';

interface UserListTableProps {
  users: UserSummary[];
  onDeleteUser: (userId: string) => Promise<void>;
  currentUserId?: string;
}

export const UserListTable: React.FC<UserListTableProps> = ({
  users,
  onDeleteUser,
  currentUserId,
}) => {
  const [search, setSearch] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const filteredUsers = users.filter((u) => {
    const q = search.toLowerCase();
    return (
      u.username.toLowerCase().includes(q) ||
      u.phoneNumber.includes(q) ||
      u.email.toLowerCase().includes(q) ||
      u.role.toLowerCase().includes(q)
    );
  });

  const handleDelete = async (user: UserSummary) => {
    if (user.id === currentUserId) {
      alert('You cannot delete your currently active account.');
      return;
    }

    const confirmed = confirm(
      `Are you sure you want to delete user "${user.username}" (${user.phoneNumber})?`
    );
    if (!confirmed) return;

    try {
      setDeletingId(user.id);
      await onDeleteUser(user.id);
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
      {/* Search Bar */}
      <div style={{ maxWidth: '360px' }}>
        <Input
          placeholder="Search by username, phone, email..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          leftIcon={<Search size={16} />}
        />
      </div>

      {/* User Table Card */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #e2e8f0',
          overflow: 'hidden',
          boxShadow: '0 4px 6px -1px rgba(0,0,0,0.02)',
        }}
      >
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: 'var(--text-muted)' }}>
                <th style={{ padding: '14px 18px', fontWeight: 600 }}>User / Identity</th>
                <th style={{ padding: '14px 18px', fontWeight: 600 }}>Phone Number</th>
                <th style={{ padding: '14px 18px', fontWeight: 600 }}>Email Address</th>
                <th style={{ padding: '14px 18px', fontWeight: 600 }}>Role</th>
                <th style={{ padding: '14px 18px', fontWeight: 600 }}>Created</th>
                <th style={{ padding: '14px 18px', fontWeight: 600, textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredUsers.length === 0 ? (
                <tr>
                  <td colSpan={6} style={{ padding: '36px 18px', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No users found matching your search.
                  </td>
                </tr>
              ) : (
                filteredUsers.map((u) => {
                  const isCurrent = u.id === currentUserId;

                  return (
                    <motion.tr
                      key={u.id}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      style={{
                        borderBottom: '1px solid #f1f5f9',
                        transition: 'background 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      {/* Identity */}
                      <td style={{ padding: '14px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div
                            style={{
                              width: '36px',
                              height: '36px',
                              borderRadius: '50%',
                              background: 'linear-gradient(135deg, #e0f2fe 0%, #bae6fd 100%)',
                              color: 'var(--primary)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontWeight: 700,
                              fontSize: '14px',
                            }}
                          >
                            {u.username.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div style={{ fontWeight: 600, color: 'var(--text-main)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <span>{u.username}</span>
                              {isCurrent && (
                                <Badge variant="primary">You</Badge>
                              )}
                            </div>
                            <span style={{ fontSize: '11px', color: 'var(--text-subtle)' }}>ID: {u.id}</span>
                          </div>
                        </div>
                      </td>

                      {/* Phone */}
                      <td style={{ padding: '14px 18px', color: 'var(--text-main)' }}>
                        {u.phoneNumber}
                      </td>

                      {/* Email */}
                      <td style={{ padding: '14px 18px', color: 'var(--text-muted)' }}>
                        {u.email}
                      </td>

                      {/* Role */}
                      <td style={{ padding: '14px 18px' }}>
                        <Badge
                          variant={u.role === 'admin' ? 'primary' : u.role === 'manager' ? 'warning' : 'success'}
                        >
                          {u.role.toUpperCase()}
                        </Badge>
                      </td>

                      {/* Date */}
                      <td style={{ padding: '14px 18px', color: 'var(--text-subtle)', fontSize: '12px' }}>
                        {new Date(u.createdAt).toLocaleDateString()}
                      </td>

                      {/* Actions */}
                      <td style={{ padding: '14px 18px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={() => handleDelete(u)}
                          disabled={isCurrent || deletingId === u.id}
                          className="spatial-btn-secondary"
                          style={{
                            padding: '6px 10px',
                            borderRadius: '8px',
                            fontSize: '12px',
                            color: isCurrent ? '#94a3b8' : '#e11d48',
                            border: '1px solid #fee2e2',
                            cursor: isCurrent ? 'not-allowed' : 'pointer',
                          }}
                          title={isCurrent ? 'Cannot delete currently active account' : 'Delete user'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </motion.tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

