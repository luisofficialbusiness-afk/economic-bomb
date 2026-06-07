const Config = require('./models/Config');
const Stock = require('./models/Stock');

const EVENT_COOLDOWN = 60 * 60 * 1000;
const dashboardEventCooldowns = new Map();

const EVENTS = [
    { id: 'double_work',    name: 'Double Work Payouts',  emoji: '💼', duration: 30, instant: false },
    { id: 'double_daily',   name: 'Double Daily Rewards', emoji: '🎁', duration: 1440, instant: false },
    { id: 'crime_boost',    name: 'Crime Wave',           emoji: '🔪', duration: 30, instant: false },
    { id: 'rob_boost',      name: 'Open Season',          emoji: '🥷', duration: 30, instant: false },
    { id: 'gambling_boost', name: 'Hot Table',            emoji: '🎰', duration: 30, instant: false },
    { id: 'fishing_boost',  name: 'Feeding Frenzy',       emoji: '🎣', duration: 30, instant: false },
    { id: 'mining_boost',   name: 'Rich Vein',            emoji: '⛏️', duration: 30, instant: false },
    { id: 'tax_holiday',    name: 'Tax Holiday',          emoji: '🏦', duration: 60, instant: false },
    { id: 'stock_surge',    name: 'Market Surge',         emoji: '📈', duration: 0,  instant: true },
    { id: 'stock_crash',    name: 'Market Crash',         emoji: '📉', duration: 0,  instant: true },
];

function registerEventRoutes(app) {

    app.get('/api/event/config', async (req, res) => {
        if (!req.session.user || !req.session.guild) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const guildId = req.session.guild.id;
            const config = await Config.findOne({ guildId });
            res.json({
                eventChannelId: config?.eventChannelId || null,
                eventRoleId: config?.eventRoleId || null,
            });
        } catch {
            res.status(500).json({ error: 'Failed' });
        }
    });

    app.post('/api/event/config', async (req, res) => {
        if (!req.session.user || !req.session.guild) return res.status(401).json({ error: 'Unauthorized' });
        const { eventChannelId, eventRoleId } = req.body;
        try {
            const guildId = req.session.guild.id;
            await Config.findOneAndUpdate(
                { guildId },
                { $set: { eventChannelId: eventChannelId || null, eventRoleId: eventRoleId || null } },
                { upsert: true, new: true }
            );
            res.json({ success: true });
        } catch {
            res.status(500).json({ error: 'Failed' });
        }
    });

    app.get('/api/event/cooldown', (req, res) => {
        if (!req.session.user || !req.session.guild) return res.status(401).json({ error: 'Unauthorized' });
        const guildId = req.session.guild.id;
        const lastUsed = dashboardEventCooldowns.get(guildId) || 0;
        const remaining = Math.max(0, EVENT_COOLDOWN - (Date.now() - lastUsed));
        res.json({ remaining, onCooldown: remaining > 0 });
    });

    app.post('/api/event/start', async (req, res) => {
        if (!req.session.user || !req.session.guild) return res.status(401).json({ error: 'Unauthorized' });
        const { eventId } = req.body;
        if (!eventId) return res.status(400).json({ error: 'Missing eventId' });

        const event = EVENTS.find(e => e.id === eventId);
        if (!event) return res.status(400).json({ error: 'Unknown event' });

        const guildId = req.session.guild.id;
        const now = Date.now();
        const lastUsed = dashboardEventCooldowns.get(guildId) || 0;

        if (now - lastUsed < EVENT_COOLDOWN) {
            const remaining = EVENT_COOLDOWN - (now - lastUsed);
            const m = Math.floor(remaining / 60000);
            const s = Math.ceil((remaining % 60000) / 1000);
            return res.status(429).json({ error: `Event on cooldown. Try again in ${m}m ${s}s.`, remaining });
        }

        dashboardEventCooldowns.set(guildId, now);

        try {
            if (event.instant) {
                const stocks = await Stock.find({ guildId });
                for (const stock of stocks) {
                    const isSurge = eventId === 'stock_surge';
                    const pct = isSurge
                        ? 1 + (0.05 + Math.random() * 0.10)
                        : 1 - (0.10 + Math.random() * 0.15);
                    stock.price = Math.max(0.01, parseFloat((stock.price * pct).toFixed(2)));
                    stock.history.push(stock.price);
                    if (stock.history.length > 30) stock.history.shift();
                    await stock.save();
                }
            }

            res.json({ success: true, event: event.name, duration: event.duration });
        } catch {
            res.status(500).json({ error: 'Failed to start event' });
        }
    });

    app.get('/api/event/list', (req, res) => {
        if (!req.session.user || !req.session.guild) return res.status(401).json({ error: 'Unauthorized' });
        res.json(EVENTS);
    });

    app.get('/api/channels/roles', async (req, res) => {
        if (!req.session.user || !req.session.guild) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const guildId = req.session.guild.id;
            const fetch = require('node-fetch');
            const rolesRes = await fetch(`https://discord.com/api/guilds/${guildId}/roles`, {
                headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` }
            });
            const roles = await rolesRes.json();
            if (!Array.isArray(roles)) return res.status(500).json({ error: 'Discord API error' });
            res.json(roles
                .filter(r => r.name !== '@everyone')
                .sort((a, b) => b.position - a.position)
                .map(r => ({ id: r.id, name: r.name, color: r.color }))
            );
        } catch {
            res.status(500).json({ error: 'Failed to fetch roles' });
        }
    });
}

module.exports = { registerEventRoutes };
