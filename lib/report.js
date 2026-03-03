const { evaluateMatch } = require("./model");
const cfg = require("./config");

function isTopLeagueMatch(m) {
  const id = m.competition?.id;
  if (!id) return true; // если id нет — не режем
  return cfg.topCompetitionIds.includes(id);
}

function buildReport(matches, limit) {
  if (!matches?.length) return null;

  const filtered = matches.filter(isTopLeagueMatch);
  const scored = filtered.map(evaluateMatch).sort((a, b) => b.score - a.score);
  const top = scored.slice(0, limit);

  if (top.length === 0) return null;

  let report = "📈 *Т-УТ*\n\n";
  top.forEach((t) => {
    report += `🏟 *${t.home} — ${t.away}*\n`;
    report += `🎯 ${t.prediction}\n`;
    report += `📊 ${t.percent}%\n\n`;
  });
  report += "⚠️ Вероятностная модель, не гарантия.\n";
  return report;
}

module.exports = { buildReport };
