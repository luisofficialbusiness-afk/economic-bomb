const fetch = require('node-fetch');
const User = require('./models/User');
const Slave = require('./models/Slave');
const Stock = require('./models/Stock');

const publicActivityFeed = [];
const MAX_PUBLIC_ACTIVITY = 200;
const SERVER_START = new Date().toISOString();

function registerPublicRoutes(app) {

    app.post('/api/public/activity', (req, res) => {
        const { secret, ...event } = req.body;
        if (secret !== process.env.ACTIVITY_SECRET) return res.status(403).json({ error: 'Unauthorized' });
        if (!event.type || !event.userId) return res.status(400).json({ error: 'Missing required fields' });
        event.ts = new Date().toISOString();
        publicActivityFeed.unshift(event);
        if (publicActivityFeed.length > MAX_PUBLIC_ACTIVITY) publicActivityFeed.pop();
        res.json({ success: true });
    });

    app.get('/api/public/activity', (req, res) => {
        const limit = Math.min(parseInt(req.query.limit) || 50, 100);
        res.json(publicActivityFeed.slice(0, limit));
    });

    app.get('/api/public/leaderboard', async (req, res) => {
        try {
            const users = await User.find({}).sort({ balance: -1 }).limit(200);
            const slaves = await Slave.find({ ownerId: { $ne: null } });
            const slaveIds = new Set(slaves.map(s => s.userId));

            const PRESTIGE_BADGES = ['', '', '', '', '', '', '', '', '', '', ''];

            res.json(users.map(u => ({
                userId: u.userId,
                balance: u.balance,
                bank: u.bank,
                total: u.balance + u.bank,
                prestige: u.prestige || 0,
                prestigeBadge: PRESTIGE_BADGES[Math.min(u.prestige || 0, PRESTIGE_BADGES.length - 1)] || '',
                isEnslave: slaveIds.has(u.userId),
            })));
        } catch {
            res.status(500).json({ error: 'Failed to fetch leaderboard' });
        }
    });

    app.get('/api/public/stats', async (req, res) => {
        try {
            const [userCount, slaveCount, stockCount, moneyAgg] = await Promise.all([
                User.countDocuments(),
                Slave.countDocuments({ ownerId: { $ne: null } }),
                Stock.countDocuments(),
                User.aggregate([{ $group: { _id: null, total: { $sum: { $add: ['$balance', '$bank'] } } } }]),
            ]);

            res.json({
                totalUsers: userCount,
                totalSlaves: slaveCount,
                totalStocks: stockCount,
                totalMoney: moneyAgg[0]?.total?.toFixed(2) || '0.00',
            });
        } catch {
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });

    app.get('/api/public/status', async (req, res) => {
        try {
            const [userCount, slaveCount, stockCount, moneyAgg, lastStock, botGuildRes] = await Promise.all([
                User.countDocuments(),
                Slave.countDocuments({ ownerId: { $ne: null } }),
                Stock.countDocuments(),
                User.aggregate([{ $group: { _id: null, total: { $sum: { $add: ['$balance', '$bank'] } } } }]),
                Stock.findOne({}).sort({ _id: -1 }),
                fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }),
            ]);
            const botGuilds = await botGuildRes.json();
            const guildCount = Array.isArray(botGuilds) ? botGuilds.length : 0;

            const uptimeSec = Math.floor((Date.now() - new Date(SERVER_START)) / 1000);
            const uptimeStr = uptimeSec < 3600
                ? Math.floor(uptimeSec / 60) + 'm'
                : Math.floor(uptimeSec / 3600) + 'h ' + Math.floor((uptimeSec % 3600) / 60) + 'm';

            res.json({
                totalUsers: userCount,
                totalSlaves: slaveCount,
                totalStocks: stockCount,
                totalGuilds: guildCount,
                totalMoney: moneyAgg[0]?.total?.toFixed(2) || '0.00',
                uptime: uptimeStr,
                serverStart: SERVER_START,
                dbConnected: true,
                activityCount: publicActivityFeed.length,
                lastStockTick: lastStock?._id?.getTimestamp()?.toISOString() || null,
            });
        } catch {
            res.status(500).json({
                totalUsers: 0, totalSlaves: 0, totalStocks: 0,
                totalGuilds: 0, totalMoney: '0.00',
                uptime: '--', serverStart: SERVER_START,
                dbConnected: false, activityCount: 0, lastStockTick: null,
            });
        }
    });
}

module.exports = { registerPublicRoutes };
