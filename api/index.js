const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    return ctx.reply('💎 Premium Auditor: READY\nМониторинг активен.', 
        Markup.inlineKeyboard([
            [Markup.button.callback('📊 Провести аудит лиг', 'audit_leagues')]
        ])
    );
});

bot.action('audit_leagues', async (ctx) => {
    try {
        await ctx.answerCbQuery('Загружаю список лиг...');
        const res = await axios.get('https://free-api-live-football-data.p.rapidapi.com/football-get-all-leagues', {
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'free-api-live-football-data.p.rapidapi.com'
            }
        });

        // Достаем названия из твоего JSON (Premier League, LaLiga и т.д.)
        const popular = res.data.response.popular;
        let list = "🏆 **АКТУАЛЬНЫЕ ЛИГИ ДЛЯ АУДИТА:**\n\n";
        
        popular.slice(0, 10).forEach(league => {
            list += `📍 ${league.name} [${league.ccode}]\n`;
        });

        return ctx.replyWithMarkdown(list);
    } catch (e) {
        return ctx.reply('❌ Ошибка API. Убедись, что подписка Basic активна.');
    }
});

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try { await bot.handleUpdate(req.body, res); } catch (err) { console.error(err); }
        res.status(200).send('OK');
    }
};