/* patched: add /testapi, increase timeout, add 1 retry */
const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const CHANNEL = process.env.CHANNEL;
const CRON_SECRET = process.env.CRON_SECRET;

const ADMIN_IDS = String(process.env.ADMIN_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean)
  .map(n => Number(n)).filter(Number.isFinite);

const MIN_PERCENT_CHANNEL = Number(process.env.MIN_PERCENT_CHANNEL || 80);
const MIN_PERCENT_DM = Number(process.env.MIN_PERCENT_DM || 70);
const DEDUP_WINDOW_MS = Number(process.env.DEDUP_WINDOW_MS || 12 * 60 * 60 * 1000);

const COMMIT_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_GITHUB_COMMIT_SHA ||
  process.env.GITHUB_SHA || "unknown";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
const bot = new Telegraf(BOT_TOKEN);

const lastErrors = [];
function pushErr(where, e) {
  lastErrors.push({
    t: new Date().toISOString(),
    where,
    status: e?.response?.status ?? null,
    msg: e?.message ?? String(e),
    data: e?.response?.data ? JSON.stringify(e.response.data).slice(0, 800) : null
  });
  while (lastErrors.length > 10) lastErrors.shift();
  console.error(where, e?.response?.status, e?.message, e?.response?.data);
}

function isAdmin(ctx) {
  const id = Number(ctx?.from?.id);
  if (!Number.isFinite(id)) return false;
  if (ADMIN_IDS.length === 0) return true;
  return ADMIN_IDS.includes(id);
}

async function tgSend(chatId, text) {
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    chat_id: chatId,
    text,
    disable_web_page_preview: true
  }, { timeout: 15000 });
}

async function fetchMatchesFootballData() {
  if (!FOOTBALL_DATA_API_KEY) throw new Error("FOOTBALL_DATA_API_KEY missing");

  const url = "https://api.football-data.org/v4/matches";
  const cfg = { headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY }, timeout: 30000 };

  try {
    const res = await axios.get(url, cfg);
    return Array.isArray(res.data?.matches) ? res.data.matches : [];
  } catch (e) {
    // 1 retry on timeout/network
    if (!e?.response) {
      const res2 = await axios.get(url, cfg);
      return Array.isArray(res2.data?.matches) ? res2.data.matches : [];
    }
    throw e;
  }
}

function evaluateMatch(m) {
  const home = m.homeTeam?.name ?? "Home";
  const away = m.awayTeam?.name ?? "Away";
  const matchPower = (String(home).length + String(away).length) % 10;

  let prediction, percent;
  if (matchPower > 7) { prediction = "Over 0.5 (1H) + Over 2.5"; percent = 84; }
  else if (matchPower < 3) { prediction = "Draw (X)"; percent = 62; }
  else { prediction = "Over 2.0"; percent = 75; }

  return { home, away, prediction, percent, score: percent };
}

function buildReport(matches, limit, minPercent) {
  const scored = (matches || [])
    .map(evaluateMatch)
    .filter(x => x.percent >= minPercent)
    .sort((a,b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) return null;

  let out = "AUTO AUDIT\n\n";
  for (const s of scored) {
    out += `${s.home} vs ${s.away}\nPick: ${s.prediction}\nChance: ${s.percent}%\n\n`;
  }
  out += "Note: probabilistic model, not a guarantee.";
  return out;
}

let lastHash = null;
let lastAt = 0;
function sha1(t) { return crypto.createHash("sha1").update(t).digest("hex"); }

bot.start((ctx) => ctx.reply("Auditor: READY",
  Markup.inlineKeyboard([[Markup.button.callback("Find signals", "find_signals")]])
));

bot.action("find_signals", async (ctx) => {
  if (!isAdmin(ctx)) return ctx.reply("Access denied (admin only).");
  try {
    await ctx.answerCbQuery("Searching...");
    if (!FOOTBALL_DATA_API_KEY) return ctx.reply("FOOTBALL_DATA_API_KEY is not set.");

    const matches = await fetchMatchesFootballData();
    const report = buildReport(matches, 5, MIN_PERCENT_DM);
    if (!report) return ctx.reply("No matches (filtered/threshold).");
    return ctx.reply(report);
  } catch (e) {
    pushErr("find_signals", e);
    return ctx.reply("Error. Check env/API limits.");
  }
});

module.exports = async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (method === "GET" && url.startsWith("/health")) {
    const missing = [];
    if (!process.env.BOT_TOKEN) missing.push("BOT_TOKEN");
    if (!process.env.FOOTBALL_DATA_API_KEY) missing.push("FOOTBALL_DATA_API_KEY");
    if (!process.env.CRON_SECRET) missing.push("CRON_SECRET");
    return res.status(200).json({ ok: missing.length === 0, missing });
  }

  if (method === "GET" && url.startsWith("/version")) {
    return res.status(200).json({ ok: true, commit: COMMIT_SHA, time: new Date().toISOString() });
  }

  if (method === "GET" && url.startsWith("/diag")) {
    const u = new URL("http://localhost" + url);
    const secret = u.searchParams.get("secret");
    if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
    if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");
    return res.status(200).json({ ok: true, lastErrors });
  }

  // NEW: /testapi?secret=...
  if (method === "GET" && url.startsWith("/testapi")) {
    const u = new URL("http://localhost" + url);
    const secret = u.searchParams.get("secret");
    if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
    if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");

    const t0 = Date.now();
    try {
      const matches = await fetchMatchesFootballData();
      return res.status(200).json({ ok: true, ms: Date.now() - t0, count: matches.length });
    } catch (e) {
      pushErr("testapi", e);
      return res.status(200).json({
        ok: false,
        ms: Date.now() - t0,
        status: e?.response?.status ?? null,
        msg: e?.message ?? String(e),
        data: e?.response?.data ?? null
      });
    }
  }

  // cron (в браузере) — постим только при наличии ключа
  if (method === "GET" && url.startsWith("/cron")) {
    const u = new URL("http://localhost" + url);
    const secret = u.searchParams.get("secret");
    if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
    if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");
    if (!FOOTBALL_DATA_API_KEY) return res.status(200).send("Cron skipped: no API key");

    try {
      const matches = await fetchMatchesFootballData();
      const report = buildReport(matches, 2, MIN_PERCENT_CHANNEL);
      if (!report) return res.status(200).send("No matches");

      const h = sha1(report);
      const now = Date.now();
      if (lastHash === h && (now - lastAt) < DEDUP_WINDOW_MS) return res.status(200).send("Skipped (dedup)");
      lastHash = h; lastAt = now;

      if (!CHANNEL) return res.status(200).send("Cron skipped: no CHANNEL");
      await tgSend(CHANNEL, report);
      return res.status(200).send("Posted");
    } catch (e) {
      pushErr("cron", e);
      return res.status(500).send("Cron error");
    }
  }

  if (method === "POST") {
    try { await bot.handleUpdate(req.body, res); } catch (e) { pushErr("handleUpdate", e); }
    return res.status(200).send("OK");
  }

  return res.status(200).send("API is working");
};
