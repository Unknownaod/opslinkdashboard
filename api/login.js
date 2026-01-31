export default function handler(req, res) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,   // <-- matches Vercel env
    redirect_uri: process.env.DISCORD_REDIRECT_URI, // <-- matches Vercel env
    response_type: "code",
    scope: "identify guilds"
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
}
