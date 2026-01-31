import { MongoClient } from "mongodb";

let client;
let db;

// =======================
// Mongo Connection (serverless-safe)
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

    // =======================
    // Latest snapshot (overview)
    // =======================
    const latest = await Snapshots.find({ guildId })
      .sort({ timestamp: -1 })
      .limit(1)
      .next();

    if (!latest) {
      return res.status(404).json({ error: "No snapshot data found" });
    }

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
      offline: latest.offline || 0
    };

    // =======================
    // Timeline (messages / joins / leaves / boosts)
    // =======================
    const now = Date.now();
    const timeline = {};

    for (const [label, windowMs] of Object.entries(WINDOWS)) {
      const cutoff = new Date(now - windowMs);

      const windowSnapshots = await Snapshots.find({
        guildId,
        timestamp: { $gte: cutoff }
      })
        .sort({ timestamp: 1 })
        .toArray();

      const labels = windowSnapshots.map(s =>
        new Date(s.timestamp).toISOString().slice(0, 10)
      );

      const messages = [];
      const joins = [];
      const leaves = [];

      for (let i = 0; i < windowSnapshots.length; i++) {
        const start = new Date(windowSnapshots[i].timestamp);
        const end =
          windowSnapshots[i + 1]
            ? new Date(windowSnapshots[i + 1].timestamp)
            : new Date();

        const [msgCount, joinCount, leaveCount] = await Promise.all([
          Events.countDocuments({
            guildId,
            type: "message",
            timestamp: { $gte: start, $lt: end }
          }),
          Events.countDocuments({
            guildId,
            type: "join",
            timestamp: { $gte: start, $lt: end }
          }),
          Events.countDocuments({
            guildId,
            type: "leave",
            timestamp: { $gte: start, $lt: end }
          })
        ]);

        messages.push(msgCount);
        joins.push(joinCount);
        leaves.push(leaveCount);
      }

      timeline[label] = {
        labels,
        messages,
        joins,
        leaves,
        boosts: windowSnapshots.map(s => s.boosts || 0)
      };
    }

    // =======================
    // Top Members (messages)
    // =======================
    const messageEvents = await Events.find({
      guildId,
      type: "message"
    }).toArray();

    const memberMap = {};
    const channelMap = {};
    const emojiMap = {};

    for (const e of messageEvents) {
      const userKey = `${e.data.userId}:${e.data.username}`;
      memberMap[userKey] = (memberMap[userKey] || 0) + 1;

      const channelKey = e.data.channelName || e.data.channelId;
      channelMap[channelKey] = (channelMap[channelKey] || 0) + 1;

      for (const [emoji, count] of Object.entries(e.data.emojiCount || {})) {
        emojiMap[emoji] = (emojiMap[emoji] || 0) + count;
      }
    }

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

    // =======================
    // Voice activity (from events)
    // =======================
    const voiceEvents = await Events.find({
      guildId,
      type: "voice"
    }).toArray();

    const voiceMap = {};
    for (const e of voiceEvents) {
      const key = `${e.data.userId}:${e.data.username}`;
      voiceMap[key] = (voiceMap[key] || 0) + 1;
    }

    const topVoice = topN(voiceMap).map(x => {
      const [userId, username] = x.key.split(":");
      return { userId, username, count: x.count };
    });

    // =======================
    // Final response
    // =======================
    res.status(200).json({
      overview,
      timeline,
      topMembers,
      topChannels,
      topEmojis,
      topVoice
    });

  } catch (err) {
    console.error("❌ analytics API error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
