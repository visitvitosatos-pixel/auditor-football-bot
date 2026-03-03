const { Telegraf } = require('telegraf');
const axios = require('axios');

// Инициализация бота с токеном из переменных окружения
const bot = new Telegraf(process.env.BOT_TOKEN);

// Основной обработчик для Vercel (Serverless Function)
module.exports = async (req, res) => {
    try {
        if (req.method === 'POST') {
            // Обработка обновлений от Telegram
            await bot.handleUpdate(req.body, res);
        } else {
            // Ответ для проверки работоспособности в браузере
            res.status(200).send('Бот-Аудитор активен и работает!');
        }
    } catch (e) {
        console.error('Ошибка в Webhook:', e);
        res.status(500).send('Ошибка на стороне сервера');
    }
};

// Команда /start
bot.start((ctx) => {
    return ctx.reply('Бот-Аудитор на связи! Чтобы проверить статус футбольного API, нажми /check');
});

// Команда /check для проверки связи с RapidAPI
bot.command('check', async (ctx) => {
    try {
        const response = await axios.get('https://api-football-v1.p.rapidapi.com/v3/timezone', {
            headers: {
                'X-RapidAPI-Key': process.env.FOOTBALL_API_KEY,
                'X-RapidAPI-Host': 'api-football-v1.p.rapidapi.com'
            }
        });
        return ctx.reply('✅ API Football на Vercel работает! Найдено зон: ' + response.data.results);
    } catch (err) {
        console.error('Ошибка API:', err.message);
        return ctx.reply('❌ Ошибка API: ' + err.message);
    }
});