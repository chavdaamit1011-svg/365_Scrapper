import mongoose from 'mongoose';

/**
 * Automatically sanitizes and repairs MongoDB connection strings:
 * - URL-encodes special characters in passwords (e.g., 'Pass@1234' -> 'Pass%401234')
 * - Ensures default database name exists (appends '/the_scraper' if missing)
 * - Preserves query parameters
 */
export function sanitizeMongoUri(rawUri: string): string {
  if (!rawUri) return 'mongodb://127.0.0.1:27017/the_scraper';
  let str = rawUri.trim();
  const protocolMatch = str.match(/^(mongodb(?:\+srv)?:\/\/)(.*)$/);
  if (!protocolMatch) return str;

  const protocol = protocolMatch[1];
  const rest = protocolMatch[2];

  const atIdx = rest.lastIndexOf('@');
  if (atIdx === -1) return str;

  const userinfo = rest.slice(0, atIdx);
  let hostAndPath = rest.slice(atIdx + 1);

  const colonIdx = userinfo.indexOf(':');
  if (colonIdx === -1) return str;

  const username = decodeURIComponent(userinfo.slice(0, colonIdx));
  const password = decodeURIComponent(userinfo.slice(colonIdx + 1));

  const slashIdx = hostAndPath.indexOf('/');
  if (slashIdx === -1) {
    const qIdx = hostAndPath.indexOf('?');
    if (qIdx === -1) {
      hostAndPath = hostAndPath + '/the_scraper?retryWrites=true&w=majority';
    } else {
      hostAndPath = hostAndPath.slice(0, qIdx) + '/the_scraper' + hostAndPath.slice(qIdx);
    }
  } else {
    const afterSlash = hostAndPath.slice(slashIdx + 1);
    if (!afterSlash || afterSlash.startsWith('?')) {
      hostAndPath = hostAndPath.slice(0, slashIdx) + '/the_scraper' + (afterSlash.startsWith('?') ? afterSlash : '?retryWrites=true&w=majority');
    }
  }

  return protocol + encodeURIComponent(username) + ':' + encodeURIComponent(password) + '@' + hostAndPath;
}

const rawUri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/the_scraper';
const MONGODB_URI = sanitizeMongoUri(rawUri);

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose | null> | null;
  isConnected: boolean;
}

declare global {
  var mongooseCache: MongooseCache | undefined;
}

let cached: MongooseCache = global.mongooseCache || {
  conn: null,
  promise: null,
  isConnected: false,
};

if (!global.mongooseCache) {
  global.mongooseCache = cached;
}

export async function connectMongo(): Promise<typeof mongoose | null> {
  if (cached.conn && cached.isConnected) {
    return cached.conn;
  }

  if (!cached.promise) {
    const isCloudCluster = MONGODB_URI.includes('mongodb+srv') || !MONGODB_URI.includes('127.0.0.1');
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: isCloudCluster ? 8000 : 2000,
    };

    const maskedUri = MONGODB_URI.replace(/:([^@]+)@/, ':****@');

    cached.promise = mongoose
      .connect(MONGODB_URI, opts)
      .then((m) => {
        cached.isConnected = true;
        console.log(`[MongoDB] Connected successfully to database: ${maskedUri}`);
        return m;
      })
      .catch((err) => {
        cached.isConnected = false;
        cached.promise = null;
        console.warn(`[MongoDB] Database at ${maskedUri} not reachable (${err.message}). Using persistent disk cache.`);
        return null;
      });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    cached.conn = null;
    cached.isConnected = false;
  }

  return cached.conn;
}

// User Schema for MongoDB
const UserSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    username: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phoneNumber: { type: String, required: true, unique: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ['admin', 'user', 'manager'], default: 'user' },
    isActive: { type: Boolean, default: true },
    createdAt: { type: String, default: () => new Date().toISOString() },
    lastLogin: { type: String },
  },
  {
    timestamps: true,
  }
);

export const MongoUserModel =
  mongoose.models.User || mongoose.model('User', UserSchema);

// Scraped Results Schema for MongoDB (Collection: scraped_results)
const ScrapedResultSchema = new mongoose.Schema(
  {
    id: { type: String, required: true, unique: true },
    domain: { type: String, required: true, index: true },
    rootDomain: { type: String },
    subdomain: { type: String, default: '' },
    subdomains: { type: [String], default: [] },
    subdomainDetails: {
      type: [
        {
          subdomain: { type: String, required: true },
          status: { type: String, default: 'ACTIVE' },
          firstSeen: { type: String },
          lastSeen: { type: String },
        },
      ],
      default: [],
    },
    subdomainCount: { type: Number, default: 0 },
    email: { type: String, default: '' },
    emails: { type: [String], default: [] },
    emailCount: { type: Number, default: 0 },
    verifiedEmails: {
      type: [
        {
          email: { type: String, required: true },
          sourceUrl: { type: String, default: '' },
          discoveryMethod: { type: String, default: 'regex_body' },
          mxVerified: { type: Boolean, default: false },
          mxRecords: { type: [String], default: [] },
          priorityScore: { type: Number, default: 0 },
          isPrimary: { type: Boolean, default: false },
        },
      ],
      default: [],
    },
    crawledPages: {
      type: [
        {
          url: { type: String, required: true },
          title: { type: String, default: '' },
          statusCode: { type: Number, default: 200 },
          depth: { type: Number, default: 0 },
          timestamp: { type: String, default: '' },
        },
      ],
      default: [],
    },
    category: { type: String, default: 'Corporate & Business Services' },
    categoryIcon: { type: String, default: '🌐' },
    isEcommerce: { type: Boolean, default: false },
    ecommerceSignals: { type: [String], default: [] },
    technologies: { type: [String], default: [] },
    phones: { type: [String], default: [] },
    summary: { type: String, default: '' },
    country: { type: String, default: 'Detected' },
    countryCode: { type: String, default: 'INT' },
    countryFlag: { type: String, default: '🌐' },
    status: { type: String, default: 'RESOLVED' },
    sourceUrl: { type: String, default: '' },
    pagesCrawled: { type: Number, default: 0 },
    discoveredAt: { type: String, default: () => new Date().toISOString() },
  },
  {
    timestamps: true,
  }
);

export const MongoScrapedResultModel =
  mongoose.models.ScrapedResult ||
  mongoose.model('ScrapedResult', ScrapedResultSchema, 'scraped_results');
