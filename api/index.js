const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
if (!FOOTBALL_DATA_API_KEY) throw new Error("FOOTBALL_DATA_API_KEY missing");

const bot = new Telegraf(BOT_TOKEN);

const CACHE_TTL = 15 * 60 * 1000; // 15 мин
let cache = { at: 0, data: null };

function clamp(v, min, max){ return Math.max(min, Math.min(max, v)); }

async function getMatches(){
  const now = Date.now();
  if (cache.data && (now - cache.at) < CACHE_TTL) return cache.data;

  const res = await axios.get("https://api.football-data.org/v4/matches", {
    headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY },
    timeout: 20000
  });

  cache = { at: now, data: res.data.matches || [] };
  return cache.data;
}

async function getTeamStats(teamId){
  const res = await axios.get(
    `https://api.football-data.org/v4/teams/${teamId}/matches?status=FINISHED&limit=5`,
    { headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY }, timeout: 20000 }
  );

  const matches = res.data.matches || [];
  let scored = 0, conceded = 0;

  matches.forEach(m=>{
    const isHome = m.homeTeam.id === teamId;
    const homeGoals = m.score.fullTime.home || 0;
    const awayGoals = m.score.fullTime.away || 0;

    if (isHome){
      scored += homeGoals;
      conceded += awayGoals;
    } else {
      scored += awayGoals;
      conceded += homeGoals;
    }
  });

  const count = matches.length || 1;
  return {
    avg_scored: scored / count,
    avg_conceded: conceded / count
  };
}

async function evaluateMatch(match){
  const homeId = match.homeTeam.id;
  const awayId = match.awayTeam.id;

  const homeStats = await getTeamStats(homeId);
  const awayStats = await getTeamStats(awayId);

  const expectedGoals =
    ((homeStats.avg_scored + awayStats.avg_conceded)/2) +
    ((awayStats.avg_scored + homeStats.avg_conceded)/2);

  if (expectedGoals < 2.6) return null;

  const probability = clamp(Math.round(expectedGoals * 25), 55, 90);

  return {
    home: match.homeTeam.name,
    away: match.awayTeam.name,
    expectedGoals: expectedGoals.toFixed(2),
    probability
  };
}

async function buildModelReport(){
  const matches = await getMatches();
  const upcoming = matches.slice(0,4); // лимит нагрузки

  const results = [];

  for (const m of upcoming){
    try{
      const evalRes = await evaluateMatch(m);
      if (evalRes) results.push(evalRes);
      if (results.length >= 3) break;
    }catch(e){
      continue;
    }
  }

  if (!results.length) return "ет подходящих матчей под Т 2.5.";

  let out = "⚽ одель Т 2.5\n\n";

  results.forEach(r=>{
    out += `${r.home} — ${r.away}\n`;
    out += `📈 Ставка: Т 2.5\n`;
    out += `📊 ероятность: ${r.probability}%\n`;
    out += `⚙ жидаемые голы: ${r.expectedGoals}\n\n`;
  });

  out += "ℹ️ сновано на последних 5 матчах команд.";
  return out;
}

function keyboard(){
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔍 айти сигналы (Т 2.5)", "model")]
  ]);
}

bot.start(ctx=>{
  ctx.reply("🤖 еальная модель активна", keyboard());
});

bot.action("model", async ctx=>{
  try{
    const report = await buildModelReport();
    ctx.reply(report);
  }catch(e){
    ctx.reply("шибка модели / лимит API.");
  }
});

module.exports = async (req,res)=>{
  if (req.method==="POST"){
    await bot.handleUpdate(req.body,res);
    return res.status(200).send("OK");
  }
  return res.status(200).send("API работает");
};
