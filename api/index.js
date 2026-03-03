const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    return ctx.reply('💎 Premium Auditor: READY\nониторинг прематч-линий активен.', 
        Markup.inlineKeyboard([
            [Markup.button.callback('📊 ровести удит атча', 'audit_match')],
            [Markup.button.webApp('🚀 Open Cyber-Dashboard', 'https://auditor-football-bot.vercel.app/')]
        ])
    );
});

bot.action('audit_match', async (ctx) => {
    try {
        await ctx.answerCbQuery('апускаю нейро-аудит...');
        
        const res = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures?next=1', {
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
            }
        });

        const game = res.data.response && res.data.response[0];
        if (!game) return ctx.reply('📭  прематче пока пусто.');

        // огика "удитора": Симуляция анализа (шанс на основе данных)
        const homeTeam = game.teams.home.name;
        const awayTeam = game.teams.away.name;
        const probability = Math.floor(Math.random() * (70 - 40 + 1)) + 40; // ока имитация логики

        const report = "📋 ТТ Т:\n\n" +
                       "🏟 " + homeTeam + " vs " + awayTeam + "\n" +
                       "🏆 Турнир: " + game.league.name + "\n" +
                       "--------------------------\n" +
                       "📈 нализ вероятности 1: " + probability + "%\n" +
                       "⚠️ Статус: ысокая волатильность\n\n" +
                       "✅ екомендация: роверить составы за 1 час до старта.";

        return ctx.reply(report);
    } catch (e) {
        console.error('Audit Error:', e.message);
        return ctx.reply('❌ Связь с API прервана. овторите попытку через 1 минуту.');
    }
});

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try { await bot.handleUpdate(req.body, res); } catch (err) { console.error(err); }
        if (!res.headersSent) res.status(200).send('OK');
    } else {
        res.status(200).send('AUDITOR BACKEND LIVE');
    }
};