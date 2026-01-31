// /api/logout.js
export default function handler(req, res) {
  // Clear the discord_token cookie
  res.setHeader("Set-Cookie", "discord_token=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax");

  // Redirect to homepage
  res.writeHead(302, { Location: "/" });
  res.end();
}
