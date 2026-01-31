export default async function handler(req, res) {
  const code = req.query.code;
  if (!code) return res.status(400).send("Missing code");

  const data = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: "authorization_code",
    code,
    redirect_uri: process.env.DISCORD_REDIRECT_URI
  });

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: data
  });

  const token = await tokenRes.json();
  if (!token.access_token) return res.status(500).json(token);

  // Store token securely in a cookie
  res.setHeader(
    "Set-Cookie",
    `discord_token=${token.access_token}; HttpOnly; Secure; Path=/; SameSite=Lax`
  );

  res.redirect("/guilds.html");
}
