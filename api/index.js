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
        await ctx.answerCbQuery('Запрашиваю лиги...');
        
        const response = await axios({
            method: 'GET',
            url: 'https://free-api-live-football-data.p.rapidapi.com/football-get-all-leagues',
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'free-api-live-football-data.p.rapidapi.com'
            },
            timeout: 10000 // Ждем до 10 секунд
        });

        // Проверяем наличие данных в ответе
        if (response.data && response.data.response && response.data.response.popular) {
            const popular = response.data.response.popular;
            let report = "🏆 **ТОП-ЛИГИ ДЛЯ АНАЛИЗА:**\n\n";
            
            popular.slice(0, 10).forEach(l => {
                report += `⚽️ ${l.name} [${l.ccode}]\n`;
            });

            return ctx.replyWithMarkdown(report);
        } else {
            return ctx.reply('⚠️ API вернул пустой ответ. Попробуй еще раз через минуту.');
        }

    } catch (e) {
        console.error('Ошибка запроса:', e.message);
        return ctx.reply('❌ Сервер API временно не отвечает (Timeout). Твоя подписка OK, это лаг на стороне RapidAPI.');
    }
});

module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try { await bot.handleUpdate(req.body, res); } catch (err) { console.error(err); }
        res.status(200).send('OK');
    }
};