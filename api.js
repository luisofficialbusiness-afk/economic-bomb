const fetch = require('node-fetch');
const User = require('./models/User');
const Slave = require('./models/Slave');
const Stock = require('./models/Stock');
const Portfolio = require('./models/Portfolio');

const RATE_LIMIT_WINDOW = 60 * 1000;
const RATE_LIMIT_MAX = 30;
const ipHits = new Map();

const PRESTIGE_BADGES = ['', '★', '★★', '★★★', '✦', '✦✦', '✦✦✦', '◆', '◆◆', '◆◆◆', '👑'];

function rateLimit(req, res, next) {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress;
    const now = Date.now();
    const entry = ipHits.get(ip) || { count: 0, reset: now + RATE_LIMIT_WINDOW };

    if (now > entry.reset) {
        entry.count = 0;
        entry.reset = now + RATE_LIMIT_WINDOW;
    }

    entry.count++;
    ipHits.set(ip, entry);

    res.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, RATE_LIMIT_MAX - entry.count));
    res.setHeader('X-RateLimit-Reset', entry.reset);

    if (entry.count > RATE_LIMIT_MAX) {
        return res.status(429).json({
            error: 'Rate limit exceeded.',
            retryAfter: Math.ceil((entry.reset - now) / 1000),
        });
    }

    next();
}

setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of ipHits.entries()) {
        if (now > entry.reset) ipHits.delete(ip);
    }
}, 5 * 60 * 1000);

function apiResponse(res, data) {
    res.json({ ok: true, data, timestamp: new Date().toISOString() });
}

function apiError(res, status, message) {
    res.status(status).json({ ok: false, error: message, timestamp: new Date().toISOString() });
}

function registerAPI(app) {

    app.use('/api/v1', rateLimit);

    app.get('/api/v1', (req, res) => {
        res.json({
            ok: true,
            name: 'Economic Bomb API',
            version: '1.1.0',
            docs: 'http://economicbomb.nrglearning.xyz/api-docs.html',
            rateLimit: `${RATE_LIMIT_MAX} requests per minute per IP`,
            note: 'Economy is global. guildId on player endpoint is deprecated.',
            endpoints: [
                'GET /api/v1/player/:userId',
                'GET /api/v1/player/:userId/portfolio?guildId=',
                'GET /api/v1/leaderboard/global?sort=&limit=',
                'GET /api/v1/stats',
            ],
        });
    });

    app.get('/api/v1/player/:userId', async (req, res) => {
        const { userId } = req.params;

        if (!userId || !/^\d{17,20}$/.test(userId))
            return apiError(res, 400, 'Invalid userId. Must be a valid Discord snowflake.');

        try {
            const user = await User.findOne({ userId }).lean();

            if (!user)
                return apiError(res, 404, 'Player not found.');

            const slave = await Slave.findOne({ userId }).lean();
            const ownedSlaves = await Slave.find({ ownerId: userId }).lean();

            apiResponse(res, {
                userId: user.userId,
                balance: user.balance,
                bank: user.bank,
                netWorth: user.balance + user.bank,
                prestige: user.prestige || 0,
                prestigeBadge: PRESTIGE_BADGES[Math.min(user.prestige || 0, PRESTIGE_BADGES.length - 1)] || '',
                dailyStreak: user.dailyStreak || 0,
                isEnslaved: !!slave?.ownerId,
                slavesOwned: ownedSlaves.length,
            });
        } catch {
            apiError(res, 500, 'Internal server error.');
        }
    });

    app.get('/api/v1/player/:userId/portfolio', async (req, res) => {
        const { userId } = req.params;
        const { guildId } = req.query;

        if (!userId || !/^\d{17,20}$/.test(userId))
            return apiError(res, 400, 'Invalid userId.');

        if (!guildId)
            return apiError(res, 400, 'guildId query parameter is required for portfolio lookups.');

        try {
            const portfolio = await Portfolio.findOne({ userId, guildId }).lean();
            if (!portfolio || !portfolio.holdings?.length)
                return apiError(res, 404, 'No portfolio found for this player in the specified server.');

            const tickers = portfolio.holdings.map(h => h.ticker);
            const stocks = await Stock.find({ guildId, ticker: { $in: tickers } }).lean();
            const stockMap = new Map(stocks.map(s => [s.ticker, s]));

            let totalValue = 0;
            const holdings = portfolio.holdings.map(h => {
                const stock = stockMap.get(h.ticker);
                const currentPrice = stock?.price ?? 0;
                const value = currentPrice * h.shares;
                const gainLoss = value - h.avgBuyPrice * h.shares;
                totalValue += value;
                return {
                    ticker: h.ticker,
                    shares: h.shares,
                    avgBuyPrice: h.avgBuyPrice,
                    currentPrice,
                    value: parseFloat(value.toFixed(2)),
                    gainLoss: parseFloat(gainLoss.toFixed(2)),
                    gainLossPct: h.avgBuyPrice > 0
                        ? parseFloat(((gainLoss / (h.avgBuyPrice * h.shares)) * 100).toFixed(2))
                        : 0,
                };
            });

            apiResponse(res, {
                userId,
                guildId,
                totalValue: parseFloat(totalValue.toFixed(2)),
                holdings,
            });
        } catch {
            apiError(res, 500, 'Internal server error.');
        }
    });

    app.get('/api/v1/leaderboard', async (req, res) => {
        return apiError(res, 410, 'Per-server leaderboard is deprecated. Economy is now global. Use /api/v1/leaderboard/global instead.');
    });

    app.get('/api/v1/leaderboard/global', async (req, res) => {
        const { sort = 'networth', limit = 25 } = req.query;
        const cap = Math.min(parseInt(limit) || 25, 100);
        const validSorts = ['networth', 'wallet', 'bank', 'prestige'];
        const sortKey = validSorts.includes(sort) ? sort : 'networth';

        const sortField = sortKey === 'wallet' ? { balance: -1 }
            : sortKey === 'bank' ? { bank: -1 }
            : sortKey === 'prestige' ? { prestige: -1 }
            : { balance: -1 };

        try {
            let users = await User.find({}).sort(sortField).limit(sortKey === 'networth' ? 500 : cap).lean();

            if (sortKey === 'networth') {
                users = users
                    .map(u => ({ ...u, netWorth: u.balance + u.bank }))
                    .sort((a, b) => b.netWorth - a.netWorth)
                    .slice(0, cap);
            }

            const slaves = await Slave.find({ ownerId: { $ne: null } }).lean();
            const enslaved = new Set(slaves.map(s => s.userId));
            const slaveOwnerCount = {};
            slaves.forEach(s => { slaveOwnerCount[s.ownerId] = (slaveOwnerCount[s.ownerId] || 0) + 1; });

            apiResponse(res, {
                sort: sortKey,
                count: users.length,
                players: users.map((u, i) => ({
                    rank: i + 1,
                    userId: u.userId,
                    balance: u.balance,
                    bank: u.bank,
                    netWorth: parseFloat((u.balance + u.bank).toFixed(2)),
                    prestige: u.prestige || 0,
                    prestigeBadge: PRESTIGE_BADGES[Math.min(u.prestige || 0, PRESTIGE_BADGES.length - 1)] || '',
                    dailyStreak: u.dailyStreak || 0,
                    slavesOwned: slaveOwnerCount[u.userId] || 0,
                    isEnslaved: enslaved.has(u.userId),
                })),
            });
        } catch {
            apiError(res, 500, 'Internal server error.');
        }
    });

    app.get('/api/v1/stats', async (req, res) => {
        try {
            const [userCount, slaveCount, stockCount, moneyAgg, botGuildRes] = await Promise.all([
                User.countDocuments(),
                Slave.countDocuments({ ownerId: { $ne: null } }),
                Stock.countDocuments(),
                User.aggregate([{ $group: { _id: null, total: { $sum: { $add: ['$balance', '$bank'] } } } }]),
                fetch('https://discord.com/api/users/@me/guilds', { headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` } }),
            ]);
            const botGuilds = await botGuildRes.json();
            const serverCount = Array.isArray(botGuilds) ? botGuilds.length : 0;

            apiResponse(res, {
                totalPlayers: userCount,
                totalServers: serverCount,
                totalActiveSlaves: slaveCount,
                totalStocks: stockCount,
                totalMoneyInCirculation: parseFloat((moneyAgg[0]?.total ?? 0).toFixed(2)),
            });
        } catch {
            apiError(res, 500, 'Internal server error.');
        }
    });

    app.use('/api/v1/*', (req, res) => {
        apiError(res, 404, `Unknown endpoint: ${req.method} ${req.path}`);
    });
}

module.exports = { registerAPI };
