const { Telegraf } = require('telegraf');
const axios = require('axios');

const bot = new Telegraf(process.env.BOT_TOKEN);

// бработчик Webhook для Vercel
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            await bot.handleUpdate(req.body, res);
        } else {
            res.status(200).send('от-удитор запущен и работает корректно!');
        }
    } catch (e) {
        console.error('шибка в Webhook:', e);
        res.status(500).send('шибка сервера');
    }
};

// оманды бота
bot.start((ctx) => {
    return ctx.reply('⚽ от-удитор на связи!\n\nоступные команды:\n/check - роверка связи с API\n/next - лижайший матч\n/leagues - Список лиг');
});

bot.command('check', async (ctx) => {
    try {
        const response = await axios.get('https://api-football-v1.p.rapidapi.com/v3/timezone', {
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
            }
        });
        return ctx.reply('✅ API Football работает! он найдено: ' + response.data.results);
    } catch (err) {
        return ctx.reply('❌ шибка API: ' + err.message);
    }
});

bot.command('next', async (ctx) => {
    try {
        const response = await axios.get('https://api-football-v1.p.rapidapi.com/v3/fixtures', {
            params: { next: '1' },
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
            }
        });
        const game = response.data.response[0];
        if (!game) return ctx.reply('атчей не найдено.');
        const message = "🏟 лижайший матч:\n" + game.teams.home.name + " vs " + game.teams.away.name + "\nига: " + game.league.name;
        return ctx.reply(message);
    } catch (err) {
        return ctx.reply('❌ шибка получения матча: ' + err.message);
    }
});

bot.command('leagues', async (ctx) => {
    try {
        const response = await axios.get('https://api-football-v1.p.rapidapi.com/v3/leagues', {
            params: { country: 'England', season: '2024' },
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
            }
        });
        const list = response.data.response.slice(0, 5).map(item => "🏆 " + item.league.name).join('\n');
        return ctx.reply("🏴󠁧󠁢󠁥󠁮󠁧󠁿 Топ лиги нглии:\n" + list);
    } catch (err) {
        return ctx.reply('❌ шибка лиг: ' + err.message);
    }
});