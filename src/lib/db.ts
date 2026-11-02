/**
 * ==============================================================================
 * The Scraper - Unified Database Repository (MongoDB + Persistent JSON Fallback)
 * ==============================================================================
 * - Connects to MongoDB (the_scraper database)
 * - Seeds Fixed User:
 *     Email: jon222597@gmail.com
 *     Password: Pass@1234
 *     Username: jon222597
 *     Phone: 9876543211
 * - Seeds Admin:
 *     Username: admin
 *     Phone: 9876543210
 *     Password: Password@123
 */

import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import { User, UserSummary } from '@/types';
import { connectMongo, MongoUserModel } from './mongodb';

const DATA_FILE_PATH = path.join(process.cwd(), '.screpper-data.json');

const globalForDb = global as unknown as {
  screpperUsers?: User[];
};

export async function hashPassword(plain: string): Promise<string> {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(plain, salt);
}

export async function comparePassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

function createSeedUsers(): User[] {
  // Pass@1234 hash for fixed user jon222597@gmail.com
  const jonHash = bcrypt.hashSync('Pass@1234', 10);

  return [
    {
      id: 'usr_fixed_jon',
      username: 'jon222597',
      phoneNumber: '9876543211',
      email: 'jon222597@gmail.com',
      passwordHash: jonHash,
      role: 'admin',
      isActive: true,
      createdAt: new Date().toISOString(),
    },
  ];
}

function loadUsersFromDisk(): User[] {
  try {
    if (fs.existsSync(DATA_FILE_PATH)) {
      const content = fs.readFileSync(DATA_FILE_PATH, 'utf-8');
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Strip out any legacy fake admin / demo users
        const cleaned = parsed.filter(
          (u) => u.id !== 'usr_admin_001' && u.username !== 'admin' && u.id !== 'usr_demo_002'
        );

        // Ensure jon222597@gmail.com is present
        const hasJon = cleaned.some((u) => u.email === 'jon222597@gmail.com');
        if (!hasJon) {
          const seed = createSeedUsers();
          cleaned.unshift(seed[0]);
        }

        if (cleaned.length !== parsed.length || !hasJon) {
          saveUsersToDisk(cleaned);
        }
        return cleaned;
      }
    }
  } catch (err) {
    console.warn('[DB] Could not load persisted users:', err);
  }

  const seed = createSeedUsers();
  saveUsersToDisk(seed);
  return seed;
}

function saveUsersToDisk(users: User[]): void {
  try {
    fs.writeFileSync(DATA_FILE_PATH, JSON.stringify(users, null, 2), 'utf-8');
  } catch (err) {
    console.error('[DB] Failed to save users to disk:', err);
  }
}

// Sync seed users into MongoDB collection if connected
async function syncMongoSeedUsers() {
  try {
    const mongo = await connectMongo();
    if (!mongo) return;

    // Purge any fake admin from MongoDB
    await MongoUserModel.deleteMany({
      $or: [{ id: 'usr_admin_001' }, { username: 'admin' }, { id: 'usr_demo_002' }],
    });

    const count = await MongoUserModel.countDocuments();
    if (count === 0) {
      const seed = createSeedUsers();
      for (const u of seed) {
        await MongoUserModel.create(u);
      }
      console.log('[MongoDB] Seeded fixed operator jon222597@gmail.com into MongoDB.');
    } else {
      // Ensure jon222597 exists in Mongo
      const jonExists = await MongoUserModel.findOne({ email: 'jon222597@gmail.com' });
      if (!jonExists) {
        const seed = createSeedUsers();
        await MongoUserModel.create(seed[0]);
        console.log('[MongoDB] Seeded jon222597@gmail.com into MongoDB.');
      }
    }
  } catch (err: any) {
    console.warn('[MongoDB] Seed sync error:', err.message);
  }
}

// Kick off seed sync asynchronously
syncMongoSeedUsers();

if (!globalForDb.screpperUsers) {
  globalForDb.screpperUsers = loadUsersFromDisk();
}

export const db = {
  getUsers(): User[] {
    if (!globalForDb.screpperUsers || globalForDb.screpperUsers.length === 0) {
      globalForDb.screpperUsers = loadUsersFromDisk();
    }
    return globalForDb.screpperUsers;
  },

  getAllSummaries(): UserSummary[] {
    return this.getUsers().map((u) => ({
      id: u.id,
      username: u.username,
      phoneNumber: u.phoneNumber,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      createdAt: u.createdAt,
    }));
  },

  findById(id: string): User | undefined {
    return this.getUsers().find((u) => u.id === id);
  },

  findByUsername(username: string): User | undefined {
    const clean = username.trim().toLowerCase();
    return this.getUsers().find((u) => u.username.toLowerCase() === clean);
  },

  findByPhoneNumber(phone: string): User | undefined {
    const clean = phone.replace(/[\s\-\(\)]/g, '');
    return this.getUsers().find((u) => {
      const uPhone = u.phoneNumber.replace(/[\s\-\(\)]/g, '');
      return uPhone === clean || uPhone.endsWith(clean) || clean.endsWith(uPhone);
    });
  },

  findByEmail(email: string): User | undefined {
    const clean = email.trim().toLowerCase();
    return this.getUsers().find((u) => u.email.toLowerCase() === clean);
  },

  findByIdentifier(identifier: string): User | undefined {
    const clean = identifier.trim();
    let user = this.findByUsername(clean);
    if (user) return user;

    user = this.findByPhoneNumber(clean);
    if (user) return user;

    user = this.findByEmail(clean);
    return user;
  },

  async createUser(data: {
    username: string;
    phoneNumber: string;
    email: string;
    passwordPlain: string;
    role?: 'admin' | 'user' | 'manager';
  }): Promise<{ user?: UserSummary; error?: string }> {
    const users = this.getUsers();

    if (this.findByUsername(data.username)) {
      return { error: `Username "${data.username}" is already taken.` };
    }
    if (this.findByPhoneNumber(data.phoneNumber)) {
      return { error: `Phone number "${data.phoneNumber}" is already registered.` };
    }
    if (this.findByEmail(data.email)) {
      return { error: `Email address "${data.email}" is already registered.` };
    }

    const passwordHash = await hashPassword(data.passwordPlain);
    const newUser: User = {
      id: `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      username: data.username.trim().toLowerCase(),
      phoneNumber: data.phoneNumber.trim(),
      email: data.email.trim().toLowerCase(),
      passwordHash,
      role: data.role || 'user',
      isActive: true,
      createdAt: new Date().toISOString(),
    };

    // Save to Memory & Disk
    users.push(newUser);
    saveUsersToDisk(users);

    // Save to MongoDB if available
    try {
      const mongo = await connectMongo();
      if (mongo) {
        await MongoUserModel.create(newUser);
      }
    } catch (e: any) {
      console.warn('[MongoDB] Save to mongo bypassed, saved to local cache:', e.message);
    }

    return {
      user: {
        id: newUser.id,
        username: newUser.username,
        phoneNumber: newUser.phoneNumber,
        email: newUser.email,
        role: newUser.role,
        isActive: newUser.isActive,
        createdAt: newUser.createdAt,
      },
    };
  },

  updateLastLogin(userId: string): void {
    const users = this.getUsers();
    const index = users.findIndex((u) => u.id === userId);
    if (index !== -1) {
      users[index].lastLogin = new Date().toISOString();
      saveUsersToDisk(users);

      connectMongo().then((m) => {
        if (m) {
          MongoUserModel.updateOne({ id: userId }, { lastLogin: users[index].lastLogin }).exec();
        }
      }).catch(() => {});
    }
  },

  deleteUser(userId: string): boolean {
    const users = this.getUsers();
    const filtered = users.filter((u) => u.id !== userId);
    if (filtered.length !== users.length) {
      globalForDb.screpperUsers = filtered;
      saveUsersToDisk(filtered);

      connectMongo().then((m) => {
        if (m) {
          MongoUserModel.deleteOne({ id: userId }).exec();
        }
      }).catch(() => {});

      return true;
    }
    return false;
  },
};
