export default function handler(req, res) {
  const params = new URLSearchParams({
    client_id: process.env.CLIENT_ID,
    redirect_uri: process.env.REDIRECT_URI,
    response_type: "code",
    scope: "identify guilds"
  });

  res.redirect(`https://discord.com/api/oauth2/authorize?${params.toString()}`);
}
