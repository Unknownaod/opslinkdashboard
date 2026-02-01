import { MongoClient } from "mongodb";

let client;
let cachedDb;

// =======================
// Mongo Connection (serverless-safe)
// =======================
async function connectMongo() {
  if (cachedDb) return cachedDb;

  if (!process.env.MONGO_URI) {
    throw new Error("Missing MONGO_URI");
  }

  client ??= new MongoClient(process.env.MONGO_URI);
  if (!client.topology?.isConnected()) {
    await client.connect();
  }

  cachedDb = client.db();
  return cachedDb;
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
  "30d": 30 * 24 * 60 * 60 * 1000
};

// =======================
// API Handler
// =======================
export default async function handler(req, res) {
  const { guildId } = req.query;
  if (!guildId) {
    return res.status(400).json({ error: "No guildId provided" });
  }

  try {
    const db = await connectMongo();

    const Events = db.collection("events");
    const Snapshots = db.collection("snapshots");
    const GuildStats = db.collection("guildstats");

    // =======================
    // Latest snapshot
    // =======================
    const latest = await Snapshots.findOne(
      { guildId },
      { sort: { timestamp: -1 } }
    );

    if (!latest) {
      return res.status(404).json({ error: "No snapshot data found" });
    }

    const overview = {
      name: latest.name ?? "Unknown Guild",
      iconURL: latest.iconURL ?? null,
      members: latest.members ?? 0,
      humans: latest.humans ?? 0,
      bots: latest.bots ?? 0,
      boosts: latest.boosts ?? 0,
      online: latest.online ?? 0,
      idle: latest.idle ?? 0,
      dnd: latest.dnd ?? 0,
      offline: latest.offline ?? 0,
      channels: latest.channels ?? {},
      roles: latest.roles ?? {},
      threads: latest.threads ?? {},
      emojis: latest.emojis ?? {},
      stickers: latest.stickers ?? {},
      topMessages: latest.topMessages ?? {},
      topVoice: latest.topVoice ?? {}
    };

    // =======================
    // Stats doc
    // =======================
    const statsDoc = await GuildStats.findOne({ guildId });

    // =======================
    // Timeline
    // =======================
    const now = Date.now();
    const timeline = {};

    const allSnapshots = await Snapshots.find({ guildId })
      .project({ timestamp: 1, boosts: 1 })
      .sort({ timestamp: 1 })
      .toArray();

    for (const [label, windowMs] of Object.entries(WINDOWS)) {
      const cutoff = now - windowMs;

      const windowSnapshots = allSnapshots.filter(s => {
        const ts = s.timestamp instanceof Date
          ? s.timestamp.getTime()
          : s.timestamp;
        return ts >= cutoff;
      });

      timeline[label] = {
        labels: windowSnapshots.map(s =>
          new Date(s.timestamp).toISOString().slice(0, 10)
        ),
        boosts: windowSnapshots.map(s => s.boosts ?? 0),
        messages: windowSnapshots.map(
          () => statsDoc?.stats?.[label]?.messages ?? 0
        ),
        joins: windowSnapshots.map(
          () => statsDoc?.stats?.[label]?.joins ?? 0
        ),
        leaves: windowSnapshots.map(
          () => statsDoc?.stats?.[label]?.leaves ?? 0
        )
      };
    }

    // =======================
    // Heavy analytics
    // =======================
    const memberMap = {};
    const channelMap = {};
    const emojiMap = {};
    const voiceMap = {};

    let joinCount = 0;
    let leaveCount = 0;
    let messageCount = 0;
    let boostCount = 0;

    const cursor = Events.find({ guildId }).project({ type: 1, data: 1 });

    await cursor.forEach(e => {
      switch (e.type) {
        case "message": {
          messageCount++;
          const userKey = `${e.data.userId}:${e.data.username}`;
          memberMap[userKey] = (memberMap[userKey] || 0) + 1;

          const channelKey = e.data.channelName || e.data.channelId;
          channelMap[channelKey] = (channelMap[channelKey] || 0) + 1;

          for (const [emoji, count] of Object.entries(e.data.emojiCount || {})) {
            emojiMap[emoji] = (emojiMap[emoji] || 0) + count;
          }
          break;
        }

        case "voice": {
          const voiceKey = `${e.data.userId}:${e.data.username}`;
          voiceMap[voiceKey] = (voiceMap[voiceKey] || 0) + 1;
          break;
        }

        case "join":
          joinCount++;
          break;

        case "leave":
          leaveCount++;
          break;

        case "boost":
          boostCount++;
          break;
      }
    });

    // =======================
    // Top lists
    // =======================
    const topMembers = topN(memberMap).map(x => {
      const [userId, username] = x.key.split(":");
      return { userId, username, count: x.count };
    });

    const topChannels = topN(channelMap).map(x => ({
      name: x.key,
      count: x.count
    }));

    const topEmojis = topN(emojiMap).map(x => ({
      emoji: x.key,
      count: x.count
    }));

    const topRoles = topN(
      Object.values(latest.roles || {}).reduce((acc, role) => {
        if (!role?.name) return acc;
        acc[role.name] = role.count ?? 0;
        return acc;
      }, {})
    ).map(x => ({ role: x.key, count: x.count }));

    const topStickers = topN(latest.stickers || {}).map(x => ({
      sticker: x.key,
      count: x.count
    }));

    const topThreads = topN(latest.threads || {}).map(x => ({
      thread: x.key,
      count: x.count
    }));

    const topVoice = topN(voiceMap).map(x => {
      const [userId, username] = x.key.split(":");
      return { userId, username, count: x.count };
    });

    // =======================
    // Response
    // =======================
    res.status(200).json({
      overview,
      timeline,
      counts: {
        joins: joinCount,
        leaves: leaveCount,
        messages: messageCount,
        boosts: boostCount
      },
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
