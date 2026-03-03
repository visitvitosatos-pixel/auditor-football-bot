const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

bot.start((ctx) => {
    return ctx.reply('💎 Premium Auditor: СИСТЕМА ГОТОВА\nВсе модули активны.', 
        Markup.inlineKeyboard([
            [Markup.button.callback('📊 Начать аудит лиг', 'audit_leagues')]
        ])
    );
});

bot.action('audit_leagues', async (ctx) => {
    try {
        await ctx.answerCbQuery('Загружаю данные из Лондона...');
        const res = await axios.get('https://free-api-live-football-data.p.rapidapi.com/football-get-all-leagues', {
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'free-api-live-football-data.p.rapidapi.com'
            }
        });

        // Берем топ-3 лиги из твоего ответа
        const popular = res.data.response.popular.slice(0, 3);
        let report = "📈 **ОТЧЕТ АУДИТОРА**\n\nДоступные рынки:\n";
        
        popular.forEach(league => {
            report += `🔹 ${league.name} (${league.ccode})\n`;
        });

        report += "\n✅ API Status: Online\n🔥 Рекомендуемая нагрузка: Низкая";

        return ctx.replyWithMarkdown(report);
    } catch (e) {
        return ctx.reply('❌ Ошибка при чтении данных. Проверьте лимиты на RapidAPI.');
    }
});

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try { await bot.handleUpdate(req.body, res); } catch (err) { console.error(err); }
        res.status(200).send('OK');
    }
};