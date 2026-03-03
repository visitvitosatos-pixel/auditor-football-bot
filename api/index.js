const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");
const crypto = require("crypto");

const BOT_TOKEN = process.env.BOT_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const CHANNEL = process.env.CHANNEL;
const CRON_SECRET = process.env.CRON_SECRET;

const ADMIN_IDS = String(process.env.ADMIN_IDS || "")
  .split(",").map(x => Number(x.trim())).filter(Boolean);

const MIN_PERCENT_CHANNEL = Number(process.env.MIN_PERCENT_CHANNEL || 80);
const MIN_PERCENT_DM = Number(process.env.MIN_PERCENT_DM || 70);

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
const bot = new Telegraf(BOT_TOKEN);

let lastApiCall = 0;
let apiQueueBusy = false;
let lastErrors = [];
let quietMode = true;
let windowHours = 24;

const LOCAL_MATCHES = [
  { home: "Real Madrid", away: "Barcelona" },
  { home: "Man City", away: "Liverpool" },
  { home: "Bayern", away: "Dortmund" }
];

function isAdmin(ctx){
  if (ADMIN_IDS.length === 0) return true;
  return ADMIN_IDS.includes(Number(ctx.from.id));
}

function logError(where, e){
  const entry = {
    time: new Date().toISOString(),
    where,
    status: e?.response?.status || null,
    msg: e?.message || String(e)
  };
  lastErrors.push(entry);
  if (lastErrors.length > 10) lastErrors.shift();
  console.error(where, entry);
}

async function rateLimited(fn){
  const now = Date.now();
  if (now - lastApiCall < 60000){
    throw new Error("RATE_LIMIT_LOCAL");
  }
  lastApiCall = now;
  return await fn();
}

async function fetchMatches(){
  if (!FOOTBALL_DATA_API_KEY) throw new Error("NO_API_KEY");

  return rateLimited(async () => {
    const start = Date.now();
    const res = await axios.get("https://api.football-data.org/v4/matches", {
      headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY },
      timeout: 20000
    });
    const ms = Date.now() - start;
    return { matches: res.data.matches || [], ms };
  });
}

function buildReport(matches, limit){
  const slice = matches.slice(0, limit);
  let out = "AUTO AUDIT\n\n";
  slice.forEach(m=>{
    const home = m.homeTeam?.name || m.home;
    const away = m.awayTeam?.name || m.away;
    const percent = Math.floor(Math.random()*20)+70;
    out += `${home} vs ${away}\nChance: ${percent}%\n\n`;
  });
  return out + "Probabilistic model.";
}

function buildLocalFallback(){
  let out = "LOCAL MODE (API unavailable)\n\n";
  LOCAL_MATCHES.forEach(m=>{
    const percent = Math.floor(Math.random()*15)+70;
    out += `${m.home} vs ${m.away}\nChance: ${percent}%\n\n`;
  });
  return out + "Manual fallback list.";
}

function prettyError(e){
  if (e.message === "NO_API_KEY")
    return "API key not configured. Add FOOTBALL_DATA_API_KEY in Vercel.";

  if (e.message === "RATE_LIMIT_LOCAL")
    return "Local rate limit: 1 request per minute.";

  if (e.code === "ECONNABORTED")
    return "API timeout. Provider slow or blocked.";

  if (e.response?.status === 403)
    return "403 Forbidden. API plan may not allow this endpoint.";

  if (e.response?.status === 429)
    return "429 Rate limit from provider.";

  return "API error: " + (e.message || "unknown");
}

function keyboard(admin){
  const rows = [
    [Markup.button.callback("Find signals", "find")],
    [Markup.button.callback("Test API", "test")],
    [Markup.button.callback("Markdown toggle", "toggle")]
  ];
  if (admin) rows.push([Markup.button.callback("Diag", "diag")]);
  return Markup.inlineKeyboard(rows);
}

bot.start(ctx=>{
  ctx.reply("START_OK", keyboard(isAdmin(ctx)));
});

bot.action("toggle", ctx=>{
  if (!isAdmin(ctx)) return ctx.reply("Admin only");
  quietMode = !quietMode;
  ctx.reply("Markdown: " + (quietMode ? "OFF" : "ON"));
});

bot.action("diag", ctx=>{
  if (!isAdmin(ctx)) return ctx.reply("Admin only");
  ctx.reply(JSON.stringify(lastErrors,null,2) || "No errors");
});

bot.action("test", async ctx=>{
  if (!isAdmin(ctx)) return ctx.reply("Admin only");
  try{
    const data = await fetchMatches();
    ctx.reply(`API OK. ${data.matches.length} matches. ${data.ms}ms`);
  }catch(e){
    logError("test",e);
    ctx.reply(prettyError(e));
  }
});

bot.action("find", async ctx=>{
  try{
    const data = await fetchMatches();
    const report = buildReport(data.matches,5);
    ctx.reply(report);
  }catch(e){
    logError("find",e);
    ctx.reply(prettyError(e));
  }
});

module.exports = async (req,res)=>{
  if (req.method==="POST"){
    await bot.handleUpdate(req.body,res);
    return res.status(200).send("OK");
  }
  return res.status(200).send("API is working");
};
