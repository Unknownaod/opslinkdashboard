export default async function handler(req, res) {
  const cookie = req.headers.cookie || "";
  const match = cookie.match(/discord_token=([^;]+)/);

  if (!match) return res.status(401).json({ error: "Not authenticated" });

  const token = match[1];

  const discordRes = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: { Authorization: `Bearer ${token}` }
  });

  const guilds = await discordRes.json();

  // Optional: Filter out guilds where the bot is not installed later
  res.status(200).json(guilds);
}
