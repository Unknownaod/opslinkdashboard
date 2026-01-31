const BOT_TOKEN = process.env.BOT_TOKEN;

export default async function handler(req, res) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/discord_token=([^;]+)/);

  if (!match) return res.status(401).json({ error: "Not authenticated" });

  const token = match[1];

  try {
    // 1️⃣ Get user's guilds
    const discordRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!discordRes.ok) {
      const text = await discordRes.text();
      console.error("Discord API error:", text);
      return res.status(discordRes.status).json({ error: "Failed to fetch user guilds" });
    }

    const userGuilds = await discordRes.json();

    // 2️⃣ Get bot's guilds
    const botRes = await fetch("https://discord.com/api/users/@me/guilds", {
      headers: { Authorization: `Bot ${BOT_TOKEN}` }
    });

    if (!botRes.ok) {
      const text = await botRes.text();
      console.error("Discord Bot API error:", text);
      return res.status(botRes.status).json({ error: "Failed to fetch bot guilds" });
    }

    const botGuilds = await botRes.json();
    const botGuildIds = new Set(botGuilds.map(g => g.id));

    // 3️⃣ Cross-match
    const inBotAndUser = [];
    const userNotInBot = [];

    userGuilds.forEach(g => {
      if (botGuildIds.has(g.id)) {
        inBotAndUser.push(g);
      } else {
        // Add bot invite link for servers the user is in but bot is not
        g.addBotLink = `https://discord.com/oauth2/authorize?client_id=${BOT_TOKEN}&permissions=8&scope=bot&guild_id=${g.id}`;
        userNotInBot.push(g);
      }
    });

    // 4️⃣ Return in the format frontend expects
    res.status(200).json({ inBotAndUser, userNotInBot });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Server error" });
  }
}
