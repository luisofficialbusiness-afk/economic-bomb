require('dotenv').config();
const express = require('express');
const session = require('express-session');
const fetch = require('node-fetch');
const mongoose = require('mongoose');
const path = require('path');

const User = require('./models/User');
const Slave = require('./models/Slave');
const Stock = require('./models/Stock');
const Portfolio = require('./models/Portfolio');
const Config = require('./models/Config');

const app = express();
app.use(express.json());

mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('MongoDB connected'))
    .catch(err => { console.error(err); process.exit(1); });

app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
    secret: process.env.SESSION_SECRET || 'economicbomb_secret',
    resave: false,
    saveUninitialized: false,
    cookie: { secure: false, maxAge: 1000 * 60 * 60 * 24 }
}));

const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const DISCORD_REDIRECT_URI = process.env.DISCORD_REDIRECT_URI || 'http://localhost:3000/auth/callback';
const BOT_INVITE = process.env.BOT_INVITE || 'https://discord.com/oauth2/authorize?client_id=' + DISCORD_CLIENT_ID + '&permissions=274878385216&scope=bot+applications.commands';

function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/');
    next();
}

async function getBotGuilds() {
    try {
        const res = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` }
        });
        const guilds = await res.json();
        return guilds.map(g => g.id);
    } catch {
        return [];
    }
}

app.get('/', (req, res) => {
    if (req.session.user && req.session.guild) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/auth/login', (req, res) => {
    const url = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify+guilds`;
    res.redirect(url);
});

app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/');
    try {
        const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: 'authorization_code',
                code,
                redirect_uri: DISCORD_REDIRECT_URI
            })
        });
        const tokenData = await tokenRes.json();
        if (!tokenData.access_token) return res.redirect('/');

        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const discordUser = await userRes.json();

        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const userGuilds = await guildsRes.json();

        const botGuilds = await getBotGuilds();
        const adminGuilds = userGuilds.filter(g => {
            const isAdmin = (g.permissions & 0x8) === 0x8;
            const botPresent = botGuilds.includes(g.id);
            return isAdmin && botPresent;
        });

        req.session.user = {
            id: discordUser.id,
            username: discordUser.username,
            avatar: discordUser.avatar
                ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
                : `https://cdn.discordapp.com/embed/avatars/0.png`
        };

        // Store access token for session refresh later
        req.session.accessToken = tokenData.access_token;

        // All admin guilds (bot present or not) — for choose-server page
        const allAdminGuilds = userGuilds.filter(g => (g.permissions & 0x8) === 0x8);
        req.session.allAdminGuilds = allAdminGuilds.map(g => ({
            id: g.id, name: g.name,
            icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null
        }));

        // Only guilds where bot is present — for dashboard switcher
        req.session.guilds = allAdminGuilds.filter(g => botGuilds.includes(g.id)).map(g => ({
            id: g.id, name: g.name,
            icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
            isAdmin: true
        }));

        if (req.session.guilds.length === 0) return res.redirect('/no-server');

        req.session.guild = req.session.guilds[0];

        res.redirect('/dashboard');
    } catch (err) {
        console.error('Auth error:', err);
        res.redirect('/');
    }
});

app.get('/no-server', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'no-server.html'));
});

app.get('/invite', (req, res) => res.redirect(BOT_INVITE));

app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

app.get("/select-server", requireAuth, (req, res) => { res.sendFile(path.join(__dirname, "public", "select-server.html")); });
app.get("/choose-server", requireAuth, (req, res) => { res.sendFile(path.join(__dirname, "public", "choose-server.html")); });

app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

app.post('/api/switch-guild', requireAuth, (req, res) => {
    const { guildId } = req.body;
    // Search both bot-present guilds and all admin guilds
    const guild = req.session.guilds?.find(g => g.id === guildId)
        || req.session.allAdminGuilds?.find(g => g.id === guildId);
    if (!guild) return res.status(403).json({ error: 'Not authorized for that server' });
    req.session.guild = { ...guild, isAdmin: true };
    res.json({ success: true, guild: req.session.guild });
});

app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user, guild: req.session.guild });
});

app.get('/api/guilds', requireAuth, (req, res) => {
    res.json(req.session.guilds || []);
});

// All guilds user is admin in (bot present or not)
app.get('/api/all-admin-guilds', requireAuth, (req, res) => {
    res.json(req.session.allAdminGuilds || req.session.guilds || []);
});

// Invite bot to a specific guild
app.get('/invite-to', requireAuth, (req, res) => {
    const { guild } = req.query;
    const base = BOT_INVITE;
    const url = guild ? `${base}&guild_id=${guild}` : base;
    res.redirect(url);
});

// Refresh session guilds after adding bot to a new server
app.post('/api/refresh-guilds', requireAuth, async (req, res) => {
    try {
        if (!req.session.accessToken) return res.json({ success: false, error: 'No access token in session' });
        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${req.session.accessToken}` }
        });
        const userGuilds = await guildsRes.json();
        if (!Array.isArray(userGuilds)) return res.json({ success: false });
        const botGuilds = await getBotGuilds();
        const adminGuilds = userGuilds.filter(g => (g.permissions & 0x8) === 0x8);

        req.session.allAdminGuilds = adminGuilds.map(g => ({
            id: g.id, name: g.name,
            icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null
        }));

        req.session.guilds = adminGuilds
            .filter(g => botGuilds.includes(g.id))
            .map(g => ({
                id: g.id, name: g.name,
                icon: g.icon ? `https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png` : null,
                isAdmin: true
            }));

        res.json({ success: true });
    } catch (err) {
        console.error('Refresh guilds error:', err);
        res.json({ success: false });
    }
});

app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const users = await User.find({ guildId });
        const totalWallet = users.reduce((a, u) => a + (u.balance || 0), 0);
        const totalBank = users.reduce((a, u) => a + (u.bank || 0), 0);
        const sorted = [...users].sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank));
        const richest = sorted[0];
        const brokest = sorted[sorted.length - 1];
        const slaves = await Slave.find({ guildId, ownerId: { $ne: null } });
        const totalDebt = slaves.reduce((a, s) => a + (s.debt || 0), 0);
        const totalSlaveEarned = slaves.reduce((a, s) => a + (s.totalEarned || 0), 0);
        const ownerCounts = {};
        for (const s of slaves) ownerCounts[s.ownerId] = (ownerCounts[s.ownerId] || 0) + 1;
        const topOwner = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

        res.json({
            totalPlayers: users.length,
            totalWallet: totalWallet.toFixed(2),
            totalBank: totalBank.toFixed(2),
            totalCirculation: (totalWallet + totalBank).toFixed(2),
            totalSlaves: slaves.length,
            totalDebt: totalDebt.toFixed(2),
            totalSlaveEarned: totalSlaveEarned.toFixed(2),
            richestId: richest?.userId || null,
            richestTotal: richest ? (richest.balance + richest.bank).toFixed(2) : '0.00',
            brokestId: brokest?.userId || null,
            avgBalance: users.length ? (totalWallet / users.length).toFixed(2) : '0.00',
            topOwner
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

app.get('/api/leaderboard', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const users = await User.find({ guildId }).sort({ balance: -1 }).limit(20);
        const slaves = await Slave.find({ guildId, ownerId: { $ne: null } });
        const slaveIds = new Set(slaves.map(s => s.userId));
        res.json(users.map(u => ({
            userId: u.userId,
            balance: u.balance,
            bank: u.bank,
            total: u.balance + u.bank,
            isEnslave: slaveIds.has(u.userId)
        })));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

app.get('/api/slaves', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const slaves = await Slave.find({ guildId, ownerId: { $ne: null } });
        res.json(slaves.map(s => ({
            userId: s.userId,
            ownerId: s.ownerId,
            debt: s.debt,
            totalEarned: s.totalEarned || 0,
            originalDebt: (s.debt + (s.totalEarned || 0))
        })));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch slaves' });
    }
});

app.get('/api/stocks', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const stocks = await Stock.find({ guildId });
        const portfolios = await Portfolio.find({});
        const holderCounts = {};
        for (const p of portfolios) {
            for (const h of p.holdings) {
                holderCounts[h.ticker] = (holderCounts[h.ticker] || 0) + 1;
            }
        }
        res.json(stocks.map(s => ({
            ticker: s.ticker,
            name: s.name,
            price: s.price,
            totalShares: s.totalShares || 0,
            history: s.history?.slice(-10) || [],
            holderCount: holderCounts[s.ticker] || 0
        })));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stocks' });
    }
});

app.get('/api/stocks/:ticker/holders', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const ticker = req.params.ticker.toUpperCase();
        const portfolios = await Portfolio.find({ guildId });
        const holders = [];
        for (const p of portfolios) {
            const h = p.holdings.find(h => h.ticker === ticker);
            if (h) holders.push({ userId: p.userId, shares: h.shares, avgBuyPrice: h.avgBuyPrice });
        }
        res.json(holders.sort((a, b) => b.shares - a.shares));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch holders' });
    }
});

app.get('/api/channels', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const channelsRes = await fetch(`https://discord.com/api/guilds/${guildId}/channels`, {
            headers: { Authorization: `Bot ${process.env.BOT_TOKEN}` }
        });
        const allChannels = await channelsRes.json();
        if (!Array.isArray(allChannels)) {
            console.error('Discord channels API error:', allChannels);
            return res.status(500).json({ error: 'Discord API error: ' + JSON.stringify(allChannels) });
        }
        const textChannels = allChannels
            .filter(c => c.type === 0)
            .sort((a, b) => a.position - b.position)
            .map(c => ({ id: c.id, name: c.name, type: 'text' }));

        const config = await Config.findOne({ guildId });
        res.json({ channels: textChannels, allowed: config?.allowedChannels || [] });
    } catch (err) {
        console.error('Channels error:', err);
        res.status(500).json({ error: 'Failed to fetch channels' });
    }
});

app.post('/api/channels', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        await Config.findOneAndUpdate(
            { guildId },
            { allowedChannels: req.body.allowed },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed to save channels' });
    }
});

app.post('/api/action/jackpot', requireAuth, async (req, res) => {
    const { amount, userId } = req.body;
    if (!amount || !userId) return res.status(400).json({ error: 'Missing fields' });
    try {
        const guildId = req.session.guild.id;
        const user = await User.findOne({ userId, guildId });
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        user.balance += parseFloat(amount);
        await user.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

app.post('/api/action/set-balance', requireAuth, async (req, res) => {
    const { userId, amount } = req.body;
    if (!userId || amount === undefined) return res.status(400).json({ error: 'Missing fields' });
    try {
        const guildId = req.session.guild.id;
        const user = await User.findOne({ userId, guildId });
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        user.balance = parseFloat(amount);
        await user.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

app.post('/api/action/set-bank', requireAuth, async (req, res) => {
    const { userId, amount } = req.body;
    if (!userId || amount === undefined) return res.status(400).json({ error: 'Missing fields' });
    try {
        const guildId = req.session.guild.id;
        const user = await User.findOne({ userId, guildId });
        if (!user) return res.status(404).json({ success: false, error: 'User not found' });
        user.bank = parseFloat(amount);
        await user.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

app.post('/api/action/set-stock', requireAuth, async (req, res) => {
    const { ticker, price } = req.body;
    if (!ticker || price === undefined) return res.status(400).json({ error: 'Missing fields' });
    try {
        const stock = await Stock.findOne({ guildId, ticker: ticker.toUpperCase() });
        if (!stock) return res.json({ success: false, error: 'Stock not found' });
        stock.price = parseFloat(price);
        stock.history.push(stock.price);
        if (stock.history.length > 30) stock.history.shift();
        await stock.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

app.post('/api/action/tick-stocks', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const stocks = await Stock.find({ guildId });
        for (const stock of stocks) {
            const change = 1 + (Math.random() * 0.06 - 0.03);
            stock.price = Math.max(0.01, parseFloat((stock.price * change).toFixed(2)));
            stock.history.push(stock.price);
            if (stock.history.length > 30) stock.history.shift();
            await stock.save();
        }
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Failed' });
    }
});

app.post('/api/action/reset-cooldowns', requireAuth, (req, res) => {
    res.json({ success: true });
});

app.get('/api/health', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const users = await User.find({ guildId });
        const slaves = await Slave.find({ guildId, ownerId: { $ne: null } });
        const totalWallet = users.reduce((a, u) => a + (u.balance || 0), 0);
        const totalBank = users.reduce((a, u) => a + (u.bank || 0), 0);
        const totalCirculation = totalWallet + totalBank;
        const totalDebt = slaves.reduce((a, s) => a + (s.debt || 0), 0);

        let score = 100;
        const issues = [];

        if (totalCirculation > 0 && totalDebt / totalCirculation > 0.5) {
            score -= 20; issues.push({ type: 'warn', msg: 'Slave debt is over 50% of total circulation' });
        }
        if (users.length > 1) {
            const sorted = [...users].sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank));
            const topShare = (sorted[0].balance + sorted[0].bank) / totalCirculation;
            if (topShare > 0.4) { score -= 15; issues.push({ type: 'warn', msg: `Top player holds ${(topShare*100).toFixed(0)}% of all money` }); }
        }
        if (users.length < 3) { score -= 10; issues.push({ type: 'info', msg: 'Less than 3 players in the economy' }); }
        if (users.length > 0 && slaves.length / users.length > 0.3) {
            score -= 15; issues.push({ type: 'warn', msg: `${(slaves.length/users.length*100).toFixed(0)}% of players are enslaved` });
        }

        const grade = score >= 85 ? 'Healthy' : score >= 65 ? 'Fair' : score >= 45 ? 'Poor' : 'Critical';
        const color = score >= 85 ? 'green' : score >= 65 ? 'yellow' : score >= 45 ? 'red' : 'red';
        res.json({ score: Math.max(0, score), grade, color, issues });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});
app.get('/api/anticheat', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const users = await User.find({ guildId });
        const flags = [];
        const MAX_LEGIT = 500000;

        for (const u of users) {
            const total = u.balance + u.bank;
            if (total > MAX_LEGIT) {
                flags.push({
                    userId: u.userId,
                    type: 'impossible_balance',
                    label: 'Impossible Balance',
                    detail: `$${total.toLocaleString()} — exceeds max possible earned`,
                    severity: 'high',
                    balance: u.balance,
                    bank: u.bank
                });
            }
        }
        for (const u of users) {
            if (u.balance > 50000 && !flags.find(f => f.userId === u.userId)) {
                flags.push({
                    userId: u.userId,
                    type: 'balance_spike',
                    label: 'Balance Spike',
                    detail: `$${u.balance.toLocaleString()} sitting in wallet`,
                    severity: 'medium',
                    balance: u.balance,
                    bank: u.bank
                });
            }
        }

        res.json(flags);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});
app.get('/api/bans', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const config = await Config.findOne({ guildId });
        res.json(config?.bannedUsers || []);
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/bans/add', requireAuth, async (req, res) => {
    const { userId, reason } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    try {
        const guildId = req.session.guild.id;
        await Config.findOneAndUpdate(
            { guildId },
            { $addToSet: { bannedUsers: { userId, reason: reason || 'No reason given', bannedAt: new Date() } } },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/bans/remove', requireAuth, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    try {
        const guildId = req.session.guild.id;
        await Config.findOneAndUpdate(
            { guildId },
            { $pull: { bannedUsers: { userId } } },
            { upsert: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});
app.get('/api/modules', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const config = await Config.findOne({ guildId });
        const defaults = {
            work: true, rob: true, coinflip: true, dice: true, slots: true,
            duel: true, stocks: true, slave: true, givemoney: true,
            deposit: true, withdraw: true, leaderboard: true
        };
        res.json({ ...defaults, ...(config?.modules || {}) });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});

app.post('/api/modules', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        await Config.findOneAndUpdate(
            { guildId },
            { modules: req.body },
            { upsert: true, new: true }
        );
        res.json({ success: true });
    } catch (err) { res.status(500).json({ error: 'Failed' }); }
});
app.post('/api/action/release-slave', requireAuth, async (req, res) => {
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'Missing userId' });
    try {
        const guildId = req.session.guild.id;
        await Slave.findOneAndUpdate({ userId, guildId }, { $set: { ownerId: null, debt: 0 } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: 'Failed' }); }
});

app.post('/api/action/seed-market', requireAuth, async (req, res) => {
    const COMPANIES = [
        { ticker: 'VLR',  name: 'Velera Inc',           price: 142.50 },
        { ticker: 'FRGS', name: "Frogiee's Arcade",      price: 34.20  },
        { ticker: 'DOGE', name: 'Doge UB',               price: 0.85   },
        { ticker: 'CHRI', name: 'Cherri Inc',             price: 58.00  },
        { ticker: 'TGLC', name: 'TGLSC Corp',             price: 210.00 },
        { ticker: 'GNMT', name: 'Gn Math',               price: 76.40  },
        { ticker: 'CNOS', name: 'Cine OS',               price: 99.99  },
        { ticker: 'OVCL', name: 'Overcloaked Corp',       price: 185.30 },
        { ticker: 'TRFL', name: 'Truffled Inc',           price: 47.60  },
        { ticker: 'LNR',  name: 'LUNAR Research Inc',     price: 320.00 },
        { ticker: 'VOID', name: 'Void Network Corp',      price: 5.55   },
        { ticker: 'HDR',  name: 'Hydra Network Corp',     price: 88.88  },
        { ticker: 'NRGX', name: 'NRG Exchange',           price: 500.00 },
        { ticker: 'PLSM', name: 'Plasma Dynamics Inc',    price: 63.75  },
        { ticker: 'ZRTH', name: 'Zeroth Systems',         price: 112.00 },
    ];
    try {
        const guildId = req.session.guild.id;
        for (const c of COMPANIES) {
            await Stock.updateOne(
                { guildId, ticker: c.ticker },
                { $set: { name: c.name, price: c.price, history: [c.price], totalShares: 0 }, $setOnInsert: { guildId, ticker: c.ticker } },
                { upsert: true }
            );
        }
        res.json({ success: true });
    } catch (err) {
        console.error('Seed market error:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

app.post('/api/action/wipe-slave-debt', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        await Slave.updateMany({ guildId }, { $set: { debt: 0, ownerId: null } });
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: 'Failed' }); }
});
app.post('/api/action/remove-stock', requireAuth, async (req, res) => {
    const { userId, ticker } = req.body;
    if (!userId || !ticker) return res.status(400).json({ error: 'Missing fields' });
    try {
        const guildId = req.session.guild.id;
        const portfolio = await Portfolio.findOne({ userId, guildId });
        if (!portfolio) return res.status(404).json({ success: false, error: 'Portfolio not found' });
        portfolio.holdings = portfolio.holdings.filter(h => h.ticker !== ticker.toUpperCase());
        await portfolio.save();
        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: 'Failed' }); }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dashboard running on http://localhost:${PORT}`));