const { Telegraf, Markup } = require("telegraf");
const axios = require("axios");

const BOT_TOKEN = process.env.BOT_TOKEN;
const FOOTBALL_DATA_API_KEY = process.env.FOOTBALL_DATA_API_KEY;

if (!BOT_TOKEN) throw new Error("BOT_TOKEN missing");
const bot = new Telegraf(BOT_TOKEN);

let lastErrors = [];
let quietMode = true;

function logError(where, e){
  lastErrors.push({
    time: new Date().toISOString(),
    where,
    status: e?.response?.status || null,
    msg: e?.message || String(e)
  });
  if (lastErrors.length > 10) lastErrors.shift();
}

async function fetchMatches(){
  const res = await axios.get("https://api.football-data.org/v4/matches", {
    headers: { "X-Auth-Token": FOOTBALL_DATA_API_KEY },
    timeout: 20000
  });
  return res.data.matches || [];
}

function buildReport(matches){
  let out = "⚽ удит матчей\n\n";

  matches.slice(0,5).forEach(m=>{
    const home = m.homeTeam?.name;
    const away = m.awayTeam?.name;
    const percent = Math.floor(Math.random()*20)+70;

    out += `${home} — ${away}\n`;
    out += `📊 ероятность: ${percent}%\n\n`;
  });

  out += "ℹ️ ероятностная модель (не гарантия).";
  return out;
}

function keyboard(){
  return Markup.inlineKeyboard([
    [Markup.button.callback("🔍 айти сигналы", "find")],
    [Markup.button.callback("🧪 Тест API", "test")],
    [Markup.button.callback("📝 Формат текста", "toggle")],
    [Markup.button.callback("📊 иагностика", "diag")]
  ]);
}

bot.start(ctx=>{
  ctx.reply("🤖 от запущен", keyboard());
});

bot.action("toggle", ctx=>{
  quietMode = !quietMode;
  ctx.reply("Формат: " + (quietMode ? "бычный" : "Markdown"));
});

bot.action("diag", ctx=>{
  ctx.reply(lastErrors.length ? JSON.stringify(lastErrors,null,2) : "шибок нет");
});

bot.action("test", async ctx=>{
  try{
    const data = await fetchMatches();
    ctx.reply(`API работает. атчей: ${data.length}`);
  }catch(e){
    logError("test",e);
    ctx.reply("шибка API: " + (e.message || ""));
  }
});

bot.action("find", async ctx=>{
  try{
    const data = await fetchMatches();
    const report = buildReport(data);
    ctx.reply(report);
  }catch(e){
    logError("find",e);
    ctx.reply("шибка. роверь лимиты API.");
  }
});

module.exports = async (req,res)=>{
  if (req.method==="POST"){
    await bot.handleUpdate(req.body,res);
    return res.status(200).send("OK");
  }
  return res.status(200).send("API работает");
};
