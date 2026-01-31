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
// Helpers
// =======================
function topN(map, n = 10) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

const WINDOWS = {
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
    const Events = db.collection("events");
    const Snapshots = db.collection("snapshots");

    // =======================
    // Latest snapshot (overview)
    // =======================
    const latest = await Snapshots.find({ guildId })
      .sort({ timestamp: -1 })
      .limit(1)
      .next();

    if (!latest)
      return res.status(404).json({ error: "No snapshot data found" });

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

    const now = Date.now();

    // =======================
    // Timeline
    // =======================
    const timeline = {};
    for (const [label, windowMs] of Object.entries(WINDOWS)) {
      const cutoff = windowMs === Infinity ? 0 : new Date(now - windowMs);

      // Load snapshots in cursor mode to avoid huge memory usage
      const windowSnapshots = [];
      await Snapshots.find({ guildId, timestamp: { $gte: cutoff } })
        .sort({ timestamp: 1 })
        .forEach(s => windowSnapshots.push(s));

      const labels = windowSnapshots.map(s => new Date(s.timestamp).toISOString().slice(0, 10));
      const messages = Array(windowSnapshots.length).fill(0);
      const joins = Array(windowSnapshots.length).fill(0);
      const leaves = Array(windowSnapshots.length).fill(0);
      const boosts = windowSnapshots.map(s => s.boosts || 0);

      // Aggregate events in single pass using cursor
      const typeMap = { message: [], join: [], leave: [] };
      await Events.find({ guildId, timestamp: { $gte: cutoff } })
        .forEach(e => { if (typeMap[e.type]) typeMap[e.type].push(new Date(e.timestamp)); });

      for (let i = 0; i < windowSnapshots.length; i++) {
        const start = new Date(windowSnapshots[i].timestamp);
        const end = i + 1 < windowSnapshots.length ? new Date(windowSnapshots[i + 1].timestamp) : new Date();

        const countEvents = (type) => typeMap[type].filter(ts => ts >= start && ts < end).length;
        messages[i] = countEvents("message");
        joins[i] = countEvents("join");
        leaves[i] = countEvents("leave");
      }

      timeline[label] = { labels, messages, joins, leaves, boosts };
    }

    // =======================
    // Top members / channels / emojis / roles / threads / stickers / voice
    // =======================
    const memberMap = {};
    const channelMap = {};
    const emojiMap = {};
    const voiceMap = {};

    // Messages
    await Events.find({ guildId, type: "message" }).forEach(e => {
      const userKey = `${e.data.userId}:${e.data.username}`;
      memberMap[userKey] = (memberMap[userKey] || 0) + 1;

      const channelKey = e.data.channelName || e.data.channelId;
      channelMap[channelKey] = (channelMap[channelKey] || 0) + 1;

      for (const [emoji, count] of Object.entries(e.data.emojiCount || {})) {
        emojiMap[emoji] = (emojiMap[emoji] || 0) + count;
      }
    });

    // Voice
    await Events.find({ guildId, type: "voice" }).forEach(e => {
      const key = `${e.data.userId}:${e.data.username}`;
      voiceMap[key] = (voiceMap[key] || 0) + 1;
    });

    const topMembers = topN(memberMap).map(x => {
      const [userId, username] = x.key.split(":");
      return { userId, username, count: x.count };
    });
    const topChannels = topN(channelMap).map(x => ({ name: x.key, count: x.count }));
    const topEmojis = topN(emojiMap).map(x => ({ emoji: x.key, count: x.count }));

    const topRoles = topN(
      Object.values(latest.roles || {}).reduce((acc, role) => {
        if (!role || !role.name) return acc;
        acc[role.name] = role.count || 0;
        return acc;
      }, {})
    ).map(x => ({ role: x.key, count: x.count }));

    const topStickers = topN(
      Object.values(latest.stickers || {}).reduce((acc, s) => {
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {})
    ).map(x => ({ sticker: x.key, count: x.count }));

    const topThreads = topN(
      Object.values(latest.threads || {}).reduce((acc, tName) => {
        acc[tName] = (acc[tName] || 0) + 1;
        return acc;
      }, {})
    ).map(x => ({ thread: x.key, count: x.count }));

    const topVoice = topN(voiceMap).map(x => {
      const [userId, username] = x.key.split(":");
      return { userId, username, count: x.count };
    });

    // =======================
    // Return all data
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
