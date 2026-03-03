function evaluateMatch(m) {
  const home = m.homeTeam?.name ?? "Home";
  const away = m.awayTeam?.name ?? "Away";

  // Заглушка модели (без гарантий)
  const matchPower = (String(home).length + String(away).length) % 10;

  let prediction, percent;
  if (matchPower > 7) { prediction = "⚽️ Т 0.5 (1Т) + Т 2.5"; percent = 84; }
  else if (matchPower < 3) { prediction = "🤝 Ничья (X)"; percent = 62; }
  else { prediction = "🔥 Т 2.0"; percent = 75; }

  return { home, away, prediction, percent, score: percent };
}

module.exports = { evaluateMatch };
