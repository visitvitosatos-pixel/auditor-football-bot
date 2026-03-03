const { Telegraf, Markup } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// Главное меню
bot.start((ctx) => {
    return ctx.reply('💎 Premium Auditor: READY\nМониторинг активен.', 
        Markup.inlineKeyboard([
            [Markup.button.callback('📊 Провести аудит лиг', 'audit_leagues')]
        ])
    );
});

// Логика кнопки аудита
bot.action('audit_leagues', async (ctx) => {
    try {
        await ctx.answerCbQuery('Загрузка данных...');
        
        // Делаем запрос к API (используем Livescores, так как он надежнее отдает данные)
        const options = {
            method: 'GET',
            url: 'https://free-api-live-football-data.p.rapidapi.com/football-get-all-livescores',
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'free-api-live-football-data.p.rapidapi.com'
            },
            timeout: 10000
        };

        const res = await axios.request(options);

        // Проверяем, что в ответе есть матчи
        if (res.data && res.data.response && res.data.response.live && res.data.response.live.length > 0) {
            const games = res.data.response.live;
            let report = "📈 **ОТЧЕТ АУДИТОРА (LIVE):**\n\n";
            
            // Выводим первые 8 активных матчей
            games.slice(0, 8).forEach(g => {
                report += `🏟 ${g.home.name} vs ${g.away.name}\n`;
                report += `🏆 ${g.league.name}\n\n`;
            });

            report += "✅ Анализ завершен.";
            return ctx.replyWithMarkdown(report);
        } else {
            // Если лайв-матчей нет, пробуем вывести список популярных лиг
            const resLeagues = await axios.get('https://free-api-live-football-data.p.rapidapi.com/football-get-all-leagues', {
                headers: {
                    'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                    'X-RapidAPI-Host': 'free-api-live-football-data.p.rapidapi.com'
                }
            });

            if (resLeagues.data && resLeagues.data.response && resLeagues.data.response.popular) {
                const popular = resLeagues.data.response.popular;
                let report = "🏆 **ДОСТУПНЫЕ ЛИГИ ДЛЯ АНАЛИЗА:**\n\n";
                popular.slice(0, 10).forEach(l => {
                    report += `⚽️ ${l.name} [${l.ccode}]\n`;
                });
                return ctx.replyWithMarkdown(report);
            }

            return ctx.reply('⚠️ Сейчас нет активных матчей и API лиг не отвечает. Попробуй позже.');
        }
    } catch (e) {
        console.error(e);
        return ctx.reply('❌ Ошибка связи с API. Проверь статус подписки на RapidAPI.');
    }
});

// Экспорт для Vercel
module.exports = async (req, res) => {
    if (req.method === 'POST') {
        try {
            await bot.handleUpdate(req.body, res);
        } catch (err) {
            console.error(err);
        }
        res.status(200).send('OK');
    } else {
        res.status(200).send('Bot is running...');
    }
};