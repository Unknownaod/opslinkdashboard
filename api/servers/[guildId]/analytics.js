import { MongoClient } from "mongodb";

let client;
let db;

// Connect to Mongo (reuse connection in serverless)
async function connectMongo() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    db = client.db(); // DB from URI
  }
  return db;
}

// Helper: Top N from a map
function topN(map, n = 5) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

// Aggregate events by type
function aggregateEvents(events, type) {
  return events.filter(e => e.type === type);
}

export default async function handler(req, res) {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: "No guildId provided" });

  try {
    const db = await connectMongo();
    const guildData = await db.collection("serveranalytics").findOne({ discordServerId: guildId });
    if (!guildData) return res.status(404).json({ error: "Guild not found" });

    const snapshots = guildData.snapshots || [];
    const events = guildData.events || [];

    // --- Latest snapshot overview ---
    const latest = snapshots[snapshots.length - 1] || {};
    const overview = {
      name: latest.name || guildData.name || "Unknown Guild",
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
      topVoice: latest.topVoice || {}
    };

    // --- Timeline: Messages, Joins, Leaves, Boosts ---
    const now = Date.now();
    const timeWindows = { "24h": 24*60*60*1000, "7d": 7*24*60*60*1000, "30d": 30*24*60*60*1000 };
    const timeline = {};

    for (const [label, windowMs] of Object.entries(timeWindows)) {
      const windowSnapshots = snapshots.filter(s => now - new Date(s.timestamp).getTime() <= windowMs);
      timeline[label] = {
        labels: windowSnapshots.map(s => new Date(s.timestamp).toISOString().slice(0,10)),
        messages: windowSnapshots.map((s,i) => {
          const start = new Date(s.timestamp);
          const end = windowSnapshots[i+1] ? new Date(windowSnapshots[i+1].timestamp) : new Date();
          return aggregateEvents(events, "message")
            .filter(e => new Date(e.timestamp) >= start && new Date(e.timestamp) < end).length;
        }),
        joins: windowSnapshots.map((s,i) => {
          const start = new Date(s.timestamp);
          const end = windowSnapshots[i+1] ? new Date(windowSnapshots[i+1].timestamp) : new Date();
          return aggregateEvents(events, "join")
            .filter(e => new Date(e.timestamp) >= start && new Date(e.timestamp) < end).length;
        }),
        leaves: windowSnapshots.map((s,i) => {
          const start = new Date(s.timestamp);
          const end = windowSnapshots[i+1] ? new Date(windowSnapshots[i+1].timestamp) : new Date();
          return aggregateEvents(events, "leave")
            .filter(e => new Date(e.timestamp) >= start && new Date(e.timestamp) < end).length;
        }),
        boosts: windowSnapshots.map(s => s.boosts || 0)
      };
    }

    // --- Top Members, Channels, Emojis, Roles, Stickers, Threads, Voice ---
    const messageEvents = aggregateEvents(events, "message");

    // Top members by messages
    const topMembersList = topN(
      messageEvents.reduce((acc, e) => {
        const username = e.data.username || e.data.userId;
        acc[username] = (acc[username] || 0) + 1;
        return acc;
      }, {}), 10
    ).map(x => ({ username: x.key, count: x.count }));

    // Top channels by messages
    const topChannelsList = topN(
      messageEvents.reduce((acc, e) => {
        const name = e.data.channelName || e.data.channelId;
        acc[name] = (acc[name] || 0) + 1;
        return acc;
      }, {}), 10
    ).map(x => ({ name: x.key, count: x.count }));

    // Top emojis
    const topEmojisList = topN(
      messageEvents.reduce((acc, e) => {
        for (const [emoji, count] of Object.entries(e.data.emojiCount || {})) {
          acc[emoji] = (acc[emoji] || 0) + count;
        }
        return acc;
      }, {}), 10
    ).map(x => ({ emoji: x.key, count: x.count }));

    // Top roles from snapshot
    const topRolesList = topN(
      Object.values(latest.roles || {}).reduce((acc, role) => {
        if (!role || !role.name) return acc;
        acc[role.name] = role.count || 0;
        return acc;
      }, {}), 10
    ).map(x => ({ role: x.key, count: x.count }));

    // Top stickers
    const topStickersList = topN(
      Object.values(latest.stickers || {}).reduce((acc, sticker) => {
        acc[sticker] = (acc[sticker] || 0) + 1;
        return acc;
      }, {}), 10
    ).map(x => ({ sticker: x.key, count: x.count }));

    // Top threads
    const topThreadsList = topN(
      Object.values(latest.threads || {}).reduce((acc, tName) => {
        acc[tName] = (acc[tName] || 0) + 1;
        return acc;
      }, {}), 10
    ).map(x => ({ thread: x.key, count: x.count }));

    // Top voice members
    const topVoiceList = topN(
      Object.values(latest.voice || {}).reduce((acc, v) => {
        if (!v || !v.members) return acc;
        Object.keys(v.members).forEach(userId => {
          acc[userId] = (acc[userId] || 0) + 1;
        });
        return acc;
      }, {}), 10
    ).map(x => ({ userId: x.key, count: x.count }));

    res.status(200).json({
      overview,
      timeline,
      topMembers: topMembersList,
      topChannels: topChannelsList,
      topEmojis: topEmojisList,
      topRoles: topRolesList,
      topStickers: topStickersList,
      topThreads: topThreadsList,
      topVoice: topVoiceList
    });

  } catch (err) {
    console.error("❌ /api/servers/[guildId]/analytics error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
