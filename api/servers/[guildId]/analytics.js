import { MongoClient } from "mongodb";

let client;
let db;

// Connect to Mongo (reuse connection in serverless)
async function connectMongo() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    db = client.db();
  }
  return db;
}

// Helper: get top N items from a map
function topN(map, n = 10) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

export default async function handler(req, res) {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: "No guildId provided" });

  try {
    const db = await connectMongo();
    const col = db.collection("serveranalytics");

    const guild = await col.findOne(
      { discordServerId: guildId },
      { projection: { snapshots: 1, events: 1, name: 1 } }
    );
    if (!guild) return res.status(404).json({ error: "Guild not found" });

    const snapshots = guild.snapshots || [];
    const events = guild.events || [];

    const latest = snapshots[snapshots.length - 1] || {};

    // -------------------------
    // Overview
    // -------------------------
    const overview = {
      name: latest.name || guild.name || "Unknown Guild",
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
      voice: latest.voice || {},
      topMessages: latest.topMessages || {},
      topReactions: latest.topReactions || {},
      topVoice: latest.topVoice || {}
    };

    // -------------------------
    // Timeline (24h, 7d, 30d)
    // -------------------------
    const now = Date.now();
    const WINDOWS = {
      "24h": 24 * 60 * 60 * 1000,
      "7d": 7 * 24 * 60 * 60 * 1000,
      "30d": 30 * 24 * 60 * 60 * 1000
    };
    const timeline = {};

    for (const [label, ms] of Object.entries(WINDOWS)) {
      const cutoff = new Date(now - ms).getTime();
      const filtered = events.filter(e => new Date(e.timestamp).getTime() >= cutoff);

      timeline[label] = {
        messages: filtered.filter(e => e.type === "message").length,
        joins: filtered.filter(e => e.type === "join").length,
        leaves: filtered.filter(e => e.type === "leave").length,
        boosts: filtered.filter(e => e.type === "boost").length
      };
    }

    // -------------------------
    // Top Members by messages
    // -------------------------
    const topMembers = topN(
      events
        .filter(e => e.type === "message" && e.data?.userId)
        .reduce((acc, e) => {
          const name = e.data.username || e.data.userId;
          acc[name] = (acc[name] || 0) + 1;
          return acc;
        }, {}),
      10
    );

    // -------------------------
    // Top Channels
    // -------------------------
    const topChannels = topN(
      events
        .filter(e => e.type === "message" && e.data?.channelId)
        .reduce((acc, e) => {
          const name = e.data.channelName || e.data.channelId;
          acc[name] = (acc[name] || 0) + 1;
          return acc;
        }, {}),
      10
    );

    // -------------------------
    // Top Emojis
    // -------------------------
    const topEmojis = topN(
      events
        .filter(e => e.type === "message")
        .reduce((acc, e) => {
          for (const [emoji, count] of Object.entries(e.data?.emojiCount || {})) {
            acc[emoji] = (acc[emoji] || 0) + count;
          }
          return acc;
        }, {}),
      10
    ).map(e => ({ key: e.key, count: e.count }));

    // -------------------------
    // Top Roles
    // -------------------------
    const topRoles = topN(
      Object.values(latest.roles || {}).reduce((acc, r) => {
        if (!r || !r.name) return acc;
        acc[r.name] = r.count || 0;
        return acc;
      }, {}),
      10
    ).map(r => ({ key: r.key, count: r.count }));

    // -------------------------
    // Top Stickers
    // -------------------------
    const topStickers = topN(
      Object.values(latest.stickers || {}).reduce((acc, s) => {
        acc[s] = (acc[s] || 0) + 1;
        return acc;
      }, {}),
      10
    ).map(s => ({ key: s.key, count: s.count }));

    // -------------------------
    // Top Threads
    // -------------------------
    const topThreads = topN(
      Object.values(latest.threads || {}).reduce((acc, t) => {
        acc[t] = (acc[t] || 0) + 1;
        return acc;
      }, {}),
      10
    ).map(t => ({ key: t.key, count: t.count }));

    // -------------------------
    // Top Voice
    // -------------------------
    const topVoice = topN(
      Object.values(latest.voice || {}).reduce((acc, v) => {
        if (!v?.members) return acc;
        Object.keys(v.members).forEach(id => {
          acc[id] = (acc[id] || 0) + 1;
        });
        return acc;
      }, {}),
      10
    ).map(v => ({ key: v.key, count: v.count }));

    // -------------------------
    // Recent Events (latest 10)
    // -------------------------
    const recentEvents = events
      .slice(-10)
      .reverse()
      .map(e => ({
        type: e.type,
        timestamp: e.timestamp,
        data: e.data
      }));

    // -------------------------
    // Return everything
    // -------------------------
    res.status(200).json({
      overview,
      timeline,
      topMembers,
      topChannels,
      topEmojis,
      topRoles,
      topStickers,
      topThreads,
      topVoice,
      events: recentEvents
    });
  } catch (err) {
    console.error("❌ Analytics API error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
