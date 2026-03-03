module.exports = {
  // едуп: если один и тот же текст уже постили в канал в этом окне — пропускаем
  dedupWindowMs: 12 * 60 * 60 * 1000,

  // Сколько матчей в канал/в личку
  channelTopN: 2,
  dmTopN: 5,

  // Фильтр "топ-лиги": когда появится football-data ключ, будет применяться
  // football-data обычно возвращает m.competition.id / name
  topCompetitionIds: [
    2021, // Premier League
    2014, // La Liga
    2019, // Serie A
    2002, // Bundesliga
    2015  // Ligue 1
  ],
};
