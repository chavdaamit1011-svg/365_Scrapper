import mongoose from 'mongoose';

const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/the_scraper';

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
    const opts = {
      bufferCommands: false,
      serverSelectionTimeoutMS: 2000, // 2s quick timeout to prevent hanging if mongod is stopped
    };

    cached.promise = mongoose
      .connect(MONGODB_URI, opts)
      .then((m) => {
        cached.isConnected = true;
        console.log(`[MongoDB] Connected successfully to database: ${MONGODB_URI}`);
        return m;
      })
      .catch((err) => {
        cached.isConnected = false;
        cached.promise = null;
        console.warn(`[MongoDB] Local MongoDB at ${MONGODB_URI} not reachable (${err.message}). Using persistent disk cache.`);
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
