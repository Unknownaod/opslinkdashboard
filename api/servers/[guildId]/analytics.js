import { MongoClient, ObjectId } from "mongodb";

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

// Helper: Top N from a map
function topN(map, n = 5) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

// Helper: Aggregate events by type
function aggregateEvents(events, type) {
  return events.filter(e => e.type === type);
}

// Helper: Summarize counts from snapshots
function aggregateSnapshots(snapshots, key) {
  return snapshots.map(s => s[key] || 0).reduce((a, b) => a + b, 0);
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
      name: guildData.name || "Unknown Guild",
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
      voice: latest.voice || {}
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
          return aggregateEvents(events.filter(e => e.type === "message"), "message")
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

    // --- Top Members, Channels, Emojis, Roles, Stickers ---
    const messageEvents = aggregateEvents(events, "message");
    const topMembers = topN(messageEvents.reduce((acc,e)=>{
      acc[e.data.userId] = (acc[e.data.userId]||0)+1;
      return acc;
    }, {}), 10).map(x => ({ username: x.key, count: x.count }));

    const topChannels = topN(messageEvents.reduce((acc,e)=>{
      acc[e.data.channelId] = (acc[e.data.channelId]||0)+1;
      return acc;
    }, {}), 10).map(x => ({ name: x.key, count: x.count }));

    const topEmojis = topN(messageEvents.reduce((acc,e)=>{
      for(const [emoji,count] of Object.entries(e.data.emojiCount||{})){
        acc[emoji]=(acc[emoji]||0)+count;
      }
      return acc;
    }, {}), 10).map(x => ({ emoji: x.key, count: x.count }));

    const topRoles = topN(Object.entries(latest.roles||{}).reduce((acc,[id,val])=>{
      acc[val.name] = val.count; return acc;
    }, {}), 10).map(x => ({ role: x.key, count: x.count }));

    const topStickers = topN(Object.entries(latest.stickers||{}).reduce((acc,[id,val])=>{
      acc[val] = (acc[val]||0)+1; return acc;
    }, {}), 10).map(x => ({ sticker: x.key, count: x.count }));

    res.status(200).json({
      overview,
      timeline,
      topMembers,
      topChannels,
      topEmojis,
      topRoles,
      topStickers
    });

  } catch (err) {
    console.error("❌ /api/servers/[guildId]/analytics error:", err);
    res.status(500).json({ error: "Server error" });
  }
}
