import { MongoClient } from "mongodb";

let client;
let db;

// Connect to Mongo (reuse connection in Vercel serverless)
async function connectMongo() {
  if (!client) {
    client = new MongoClient(process.env.MONGO_URI);
    await client.connect();
    db = client.db(); // uses DB from URI
  }
  return db;
}

export default async function handler(req, res) {
  const { guildId } = req.query;
  if (!guildId) return res.status(400).json({ error: "No guildId provided" });

  try {
    const db = await connectMongo();
    const guildData = await db.collection("serveranalytics").findOne({ discordServerId: guildId });

    if (!guildData) return res.status(404).json({ error: "Guild not found" });

    // --- Latest snapshot overview ---
    const latestSnapshot = guildData.snapshots?.[guildData.snapshots.length - 1] || {};
    const overview = {
      name: guildData.name || "Unknown Guild",
      members: latestSnapshot.members || 0,
      humans: latestSnapshot.humans || 0,
      bots: latestSnapshot.bots || 0,
      boosts: latestSnapshot.boosts || 0,
      online: latestSnapshot.online || 0,
      idle: latestSnapshot.idle || 0,
      dnd: latestSnapshot.dnd || 0,
      offline: latestSnapshot.offline || 0,
      channels: latestSnapshot.channels || {},
      roles: latestSnapshot.roles || {},
      threads: latestSnapshot.threads || {},
      emojis: latestSnapshot.emojis || {},
      stickers: latestSnapshot.stickers || {},
      voice: latestSnapshot.voice || {}
    };

    // --- Timeline (last 7 days) ---
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;
    const snapshots7d = (guildData.snapshots || []).filter(
      s => now - new Date(s.timestamp).getTime() <= sevenDays
    );

    const timeline = {
      labels: snapshots7d.map(s => new Date(s.timestamp).toISOString().slice(0, 10)),
      messages: snapshots7d.map((s, i) => {
        const start = new Date(s.timestamp);
        const end = snapshots7d[i + 1] ? new Date(snapshots7d[i + 1].timestamp) : new Date();
        return guildData.events.filter(e =>
          e.type === "message" &&
          new Date(e.timestamp) >= start &&
          new Date(e.timestamp) < end
        ).length;
      })
    };

    // --- Top Members ---
    const messageEvents = guildData.events.filter(e => e.type === "message");
    const topMembersMap = {};
    messageEvents.forEach(e => {
      const userId = e.data.userId;
      topMembersMap[userId] = (topMembersMap[userId] || 0) + 1;
    });
    const topMembers = Object.entries(topMembersMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ username: id, count }));

    // --- Top Channels ---
    const topChannelsMap = {};
    messageEvents.forEach(e => {
      const channelId = e.data.channelId;
      topChannelsMap[channelId] = (topChannelsMap[channelId] || 0) + 1;
    });
    const topChannels = Object.entries(topChannelsMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([id, count]) => ({ name: id, count }));

    // --- Top Emojis ---
    const emojiMap = {};
    messageEvents.forEach(e => {
      const emojis = e.data.emojiCount || {};
      Object.entries(emojis).forEach(([emoji, count]) => {
        emojiMap[emoji] = (emojiMap[emoji] || 0) + count;
      });
    });
    const topEmojis = Object.entries(emojiMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([emoji, count]) => ({ emoji, count }));

    res.status(200).json({
      overview,
      timeline,
      topMembers,
      topChannels,
      topEmojis
    });

  } catch (err) {
    console.error("❌ /api/servers/[guildId]/analytics error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
