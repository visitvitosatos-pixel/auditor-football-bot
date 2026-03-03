const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const crypto = require("crypto");

// ENV
const BOT_TOKEN = process.env.BOT_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const CHANNEL = process.env.CHANNEL;
const CRON_SECRET = process.env.CRON_SECRET;

const ADMIN_IDS = String(process.env.ADMIN_IDS || "")
  .split(",").map(s => s.trim()).filter(Boolean)
  .map(n => Number(n)).filter(Number.isFinite);

const MIN_PERCENT_CHANNEL = Number(process.env.MIN_PERCENT_CHANNEL || 80);
const MIN_PERCENT_DM = Number(process.env.MIN_PERCENT_DM || 70);

const CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS || 10 * 60 * 1000); // 10 min
const DEDUP_WINDOW_MS = Number(process.env.DEDUP_WINDOW_MS || 12 * 60 * 60 * 1000);

const COMMIT_SHA =
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.VERCEL_GITHUB_COMMIT_SHA ||
  process.env.GITHUB_SHA || "unknown";

if (!BOT_TOKEN) throw new Error("BOT_TOKEN is missing");
const bot = new Telegraf(BOT_TOKEN);

// runtime state (Vercel can reset on cold start)
let quietMode = true;            // default: no Markdown
let windowHours = 24;            // default
let cache = { at: 0, hours: 24, matches: null };
let lastPostHash = null;
let lastPostAt = 0;

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

function isAdminId(id) {
  if (!Number.isFinite(id)) return false;
  if (ADMIN_IDS.length === 0) return true;
  return ADMIN_IDS.includes(id);
}
function isAdminCtx(ctx) {
  return isAdminId(Number(ctx?.from?.id));
}

// Telegram send (quiet by default)
async function tgSend(chatId, text) {
  const payload = { chat_id: chatId, text, disable_web_page_preview: true };
  if (!quietMode) payload.parse_mode = "Markdown"; // если включишь
  await axios.post(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, payload, { timeout: 15000 });
}

// Backoff wrapper
async function withBackoff(fn, tries = 3) {
  let delay = 1000;
  for (let i = 0; i < tries; i++) {
    try { return await fn(); } catch (e) {
      const status = e?.response?.status;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || i === tries - 1) throw e;
      await new Promise(r => setTimeout(r, delay));
      delay *= 2;
    }
  }
}

// time window
function inNextHours(utcDate, hours) {
  const t = Date.parse(utcDate);
  if (!Number.isFinite(t)) return true;
  const now = Date.now();
  return t >= now && t <= now + hours * 60 * 60 * 1000;
}

// model (stub)
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

function buildReport(matches, limit, minPercent, hours) {
  const scored = (matches || [])
    .filter(m => inNextHours(m.utcDate, hours))
    .map(evaluateMatch)
    .filter(x => x.percent >= minPercent)
    .sort((a,b) => b.score - a.score)
    .slice(0, limit);

  if (scored.length === 0) return null;

  let out = `AUTO AUDIT (window ${hours}h)\n\n`;
  for (const s of scored) {
    out += `${s.home} vs ${s.away}\nPick: ${s.prediction}\nChance: ${s.percent}%\n\n`;
  }
  out += "Note: probabilistic model, not a guarantee.";
  return out;
}

// cached fetch
async function fetchMatchesCached(hours) {
  if (!FOOTBALL_DATA_API_KEY) throw new Error("FOOTBALL_DATA_API_KEY missing");

  const now = Date.now();
  if (cache.matches && cache.hours === hours && (now - cache.at) < CACHE_TTL_MS) {
    return cache.matches;
  }

  const url = "https://api.football-data.org/v4/matches";
  const cfg = { headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY }, timeout: 30000 };

  const matches = await withBackoff(async () => {
    const res = await axios.get(url, cfg);
    return Array.isArray(res.data?.matches) ? res.data.matches : [];
  });

  cache = { at: now, hours, matches };
  return matches;
}

function sha1(t) { return crypto.createHash("sha1").update(t).digest("hex"); }

// set webhook (internal)
async function setWebhook(req) {
  const host = req.headers["x-forwarded-host"] || req.headers["host"];
  const proto = req.headers["x-forwarded-proto"] || "https";
  const webhookUrl = `${proto}://${host}/`;

  const tg = await axios.get(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
    params: { url: webhookUrl },
    timeout: 15000
  });

  return { webhookUrl, tg: tg.data };
}

// ===== Telegram UI =====
function mainKeyboard(isAdmin) {
  const rows = [
    [Markup.button.callback("Find signals", "find_signals")],
    [
      Markup.button.callback("6h", "win_6"),
      Markup.button.callback("24h", "win_24"),
      Markup.button.callback("Today", "win_today")
    ],
    [Markup.button.callback(quietMode ? "Markdown: OFF" : "Markdown: ON", "toggle_md")]
  ];

  if (isAdmin) {
    rows.push([Markup.button.callback("Set webhook", "set_webhook")]);
    rows.push([Markup.button.callback("Diag", "diag")]);
  }
  return Markup.inlineKeyboard(rows);
}

bot.start((ctx) => {
  const admin = isAdminCtx(ctx);
  return ctx.reply("Auditor: READY", mainKeyboard(admin));
});

bot.action("toggle_md", async (ctx) => {
  if (!isAdminCtx(ctx)) return ctx.reply("Access denied (admin only).");
  quietMode = !quietMode;
  await ctx.answerCbQuery(quietMode ? "Markdown OFF" : "Markdown ON");
  return ctx.reply("Mode updated.", mainKeyboard(true));
});

bot.action("win_6", async (ctx) => { windowHours = 6; await ctx.answerCbQuery("Window: 6h"); });
bot.action("win_24", async (ctx) => { windowHours = 24; await ctx.answerCbQuery("Window: 24h"); });
bot.action("win_today", async (ctx) => { windowHours = 24; await ctx.answerCbQuery("Window: Today"); }); // упрощенно

bot.action("diag", async (ctx) => {
  if (!isAdminCtx(ctx)) return ctx.reply("Access denied (admin only).");
  await ctx.answerCbQuery("Diag");
  const text = lastErrors.length ? JSON.stringify(lastErrors, null, 2) : "No errors.";
  return ctx.reply(text);
});

bot.action("set_webhook", async (ctx) => {
  if (!isAdminCtx(ctx)) return ctx.reply("Access denied (admin only).");
  await ctx.answerCbQuery("Setting webhook...");
  try {
    // req headers not available here, so we cannot infer domain reliably from Telegram context.
    // Use browser endpoint /setwebhook?secret=... for now.
    return ctx.reply("Use: /setwebhook?secret=... in browser (domain needed).");
  } catch (e) {
    pushErr("set_webhook button", e);
    return ctx.reply("setWebhook error (see diag).");
  }
});

bot.action("find_signals", async (ctx) => {
  if (!isAdminCtx(ctx)) return ctx.reply("Access denied (admin only).");
  await ctx.answerCbQuery("Searching...");

  try {
    if (!FOOTBALL_DATA_API_KEY) {
      return ctx.reply(
        "FOOTBALL_DATA_API_KEY is not set.\n" +
        "Add it in Vercel → Settings → Environment Variables → Production."
      );
    }

    const matches = await fetchMatchesCached(windowHours);
    const report = buildReport(matches, 5, MIN_PERCENT_DM, windowHours);
    if (!report) return ctx.reply("No matches (filtered/threshold).");
    return ctx.reply(report);
  } catch (e) {
    pushErr("find_signals", e);
    await tgSend(Number(ctx.from.id), `find_signals error: ${e?.message || e}`);
    return ctx.reply("Error. Check env/API limits.");
  }
});

// ===== HTTP handler =====
module.exports = async (req, res) => {
  const url = req.url || "/";
  const method = req.method || "GET";

  if (method === "GET" && url.startsWith("/health")) {
    const missing = [];
    if (!process.env.BOT_TOKEN) missing.push("BOT_TOKEN");
    if (!process.env.FOOTBALL_DATA_API_KEY) missing.push("FOOTBALL_DATA_API_KEY");
    if (!process.env.CHANNEL) missing.push("CHANNEL");
    if (!process.env.CRON_SECRET) missing.push("CRON_SECRET");
    if (!process.env.ADMIN_IDS) missing.push("ADMIN_IDS");
    return res.status(200).json({ ok: missing.length === 0, missing });
  }

  if (method === "GET" && url.startsWith("/version")) {
    return res.status(200).json({
      ok: true,
      commit: COMMIT_SHA,
      time: new Date().toISOString(),
      windowHours,
      quietMode,
      thresholds: { MIN_PERCENT_CHANNEL, MIN_PERCENT_DM }
    });
  }

  if (method === "GET" && url.startsWith("/diag")) {
    const u = new URL("http://localhost" + url);
    const secret = u.searchParams.get("secret");
    if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
    if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");
    return res.status(200).json({ ok: true, lastErrors });
  }

  if (method === "GET" && url.startsWith("/setwebhook")) {
    const u = new URL("http://localhost" + url);
    const secret = u.searchParams.get("secret");
    if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
    if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");

    try {
      const out = await setWebhook(req);
      return res.status(200).json({ ok: true, ...out });
    } catch (e) {
      pushErr("setwebhook", e);
      return res.status(500).send("setWebhook error");
    }
  }

  if (method === "GET" && url.startsWith("/cron")) {
    const u = new URL("http://localhost" + url);
    const secret = u.searchParams.get("secret");
    if (!CRON_SECRET) return res.status(500).send("CRON_SECRET is not set");
    if (secret !== CRON_SECRET) return res.status(401).send("Unauthorized");

    if (!FOOTBALL_DATA_API_KEY) return res.status(200).send("Cron skipped: no API key");
    if (!CHANNEL) return res.status(200).send("Cron skipped: no CHANNEL");

    try {
      const matches = await fetchMatchesCached(24);
      const report = buildReport(matches, 2, MIN_PERCENT_CHANNEL, 24);
      if (!report) return res.status(200).send("No matches");

      const h = sha1(report);
      const now = Date.now();
      if (lastPostHash === h && (now - lastPostAt) < DEDUP_WINDOW_MS) return res.status(200).send("Skipped (dedup)");
      lastPostHash = h; lastPostAt = now;

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
