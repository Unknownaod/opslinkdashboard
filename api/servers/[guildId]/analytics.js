import { MongoClient } from "mongodb";

let client;
let db;

// =======================
// Mongo Connection
// =======================
async function connectMongo() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    db = client.db();
  }
  return db;
}

// =======================
// Top N helper
// =======================
function topN(map, n = 10) {
  if (!map) return [];
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

// =======================
// Time windows (ms)
// =======================
const WINDOWS_MS = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
  "overall": Infinity
};

// =======================
// API Handler
// =======================
export default async function handler(req, res) {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: "No guildId provided" });

  try {
    const db = await connectMongo();
    const Snapshots = db.collection("snapshots");

    // =======================
    // Fetch recent snapshots
    // =======================
    const snapshotDocs = await Snapshots.find({ guildId })
      .sort({ timestamp: -1 })
      .limit(100) // enough to cover 30d window
      .toArray();

    if (!snapshotDocs.length)
      return res.status(404).json({ error: "No snapshot data found" });

    const latest = snapshotDocs[0];
    const now = Date.now();

    // =======================
    // Overview
    // =======================
    const overview = {
      name: latest.name || "Unknown Guild",
      iconURL: latest.iconURL || null,
      members: latest.members || 0,
      humans: latest.humans || 0,
      bots: latest.bots || 0,
      boosts: latest.boosts || 0,
      online: latest.online || 0,
      idle: latest.idle || 0,
      dnd: latest.dnd || 0,
      offline: latest.offline || 0,
      channels: latest.channels || {},
      roles: latest.roles || {},
      threads: latest.threads || {},
      emojis: latest.emojis || {},
      stickers: latest.stickers || {},
      topMessages: latest.topMessages || {},
      topVoice: latest.topVoice || {}
    };

    // =======================
    // Timeline (messages, joins, leaves, boosts)
    // =======================
    const timeline = {};
    for (const [label, ms] of Object.entries(WINDOWS_MS)) {
      const cutoff = ms === Infinity ? 0 : now - ms;
      const windowSnapshots = snapshotDocs.filter(s => s.timestamp >= cutoff);

      timeline[label] = {
        labels: windowSnapshots.map(s => new Date(s.timestamp).toISOString().slice(0, 10)),
        messages: windowSnapshots.map(s => s.messages || 0),
        joins: windowSnapshots.map(s => s.joins || 0),
        leaves: windowSnapshots.map(s => s.leaves || 0),
        boosts: windowSnapshots.map(s => s.boosts || 0)
      };
    }

    // =======================
    // Top Members
    // =======================
    const topMembers = topN(latest.topMessages).map(x => {
      const [userId, username] = x.key.split(":");
      return { userId, username, count: x.count };
    });

    // =======================
    // Top Channels
    // =======================
    const topChannels = topN(latest.channels).map(x => ({
      id: x.key,             // preserve channel ID if stored
      name: latest.channels[x.key]?.name || x.key,
      count: x.count
    }));

    // =======================
    // Top Emojis
    // =======================
    const topEmojis = topN(latest.emojis).map(x => ({
      emoji: x.key,
      count: x.count
    }));

    // =======================
    // Top Roles
    // =======================
    const topRoles = topN(latest.roles).map(x => ({
      role: latest.roles[x.key]?.name || x.key,
      count: x.count
    }));

    // =======================
    // Top Stickers
    // =======================
    const topStickers = topN(latest.stickers).map(x => ({
      sticker: latest.stickers[x.key]?.name || x.key,
      count: x.count
    }));

    // =======================
    // Top Threads
    // =======================
    const topThreads = topN(latest.threads).map(x => ({
      thread: latest.threads[x.key]?.name || x.key,
      count: x.count
    }));

    // =======================
    // Top Voice
    // =======================
    const topVoice = topN(latest.topVoice).map(x => {
      const [userId, username] = x.key.split(":");
      return { userId, username, count: x.count };
    });

    // =======================
    // Return full payload
    // =======================
    res.status(200).json({
      overview,
      timeline,
      topMembers,
      topChannels,
      topEmojis,
      topRoles,
      topStickers,
      topThreads,
      topVoice
    });

  } catch (err) {
    console.error("❌ analytics API error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
