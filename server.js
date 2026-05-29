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

const app = express();

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

// ─── Auth middleware ───────────────────────────────────────────────
function requireAuth(req, res, next) {
    if (!req.session.user) return res.redirect('/');
    next();
}

// ─── Routes ───────────────────────────────────────────────────────

// Landing page
app.get('/', (req, res) => {
    if (req.session.user && req.session.guild) return res.redirect('/dashboard');
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Discord OAuth2 login
app.get('/auth/login', (req, res) => {
    const url = `https://discord.com/oauth2/authorize?client_id=${DISCORD_CLIENT_ID}&redirect_uri=${encodeURIComponent(DISCORD_REDIRECT_URI)}&response_type=code&scope=identify+guilds`;
    res.redirect(url);
});

// OAuth2 callback
app.get('/auth/callback', async (req, res) => {
    const { code } = req.query;
    if (!code) return res.redirect('/');

    try {
        // Exchange code for token
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

        // Get user info
        const userRes = await fetch('https://discord.com/api/users/@me', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const discordUser = await userRes.json();

        // Get user's guilds
        const guildsRes = await fetch('https://discord.com/api/users/@me/guilds', {
            headers: { Authorization: `Bearer ${tokenData.access_token}` }
        });
        const guilds = await guildsRes.json();

        // Check which guilds the user OWNS and the bot is in
        const botGuilds = await getBotGuilds();
        const ownerGuilds = guilds.filter(g => {
            const isOwner = (g.permissions & 0x8) === 0x8; // Administrator or owner
            const botPresent = botGuilds.includes(g.id);
            return isOwner && botPresent;
        });

        req.session.user = {
            id: discordUser.id,
            username: discordUser.username,
            avatar: discordUser.avatar
                ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png`
                : `https://cdn.discordapp.com/embed/avatars/0.png`
        };

        if (ownerGuilds.length === 0) {
            // Bot not in any of their servers — redirect to invite
            return res.redirect('/no-server');
        }

        // Use first matching guild (can expand to guild picker later)
        req.session.guild = ownerGuilds[0];
        res.redirect('/dashboard');

    } catch (err) {
        console.error('Auth error:', err);
        res.redirect('/');
    }
});

// No server page
app.get('/no-server', (req, res) => {
    if (!req.session.user) return res.redirect('/');
    res.sendFile(path.join(__dirname, 'public', 'no-server.html'));
});

// Invite redirect
app.get('/invite', (req, res) => res.redirect(BOT_INVITE));

// Logout
app.get('/auth/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Dashboard page
app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ─── API ──────────────────────────────────────────────────────────

// Session info
app.get('/api/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user, guild: req.session.guild });
});

// Economy stats
app.get('/api/stats', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const users = await User.find({ guildId });
        const totalWallet = users.reduce((a, u) => a + (u.balance || 0), 0);
        const totalBank = users.reduce((a, u) => a + (u.bank || 0), 0);
        const richest = users.sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank))[0];
        const slaves = await Slave.find({ guildId, ownerId: { $ne: null } });

        res.json({
            totalPlayers: users.length,
            totalWallet: totalWallet.toFixed(2),
            totalBank: totalBank.toFixed(2),
            totalCirculation: (totalWallet + totalBank).toFixed(2),
            totalSlaves: slaves.length,
            richestId: richest?.userId || null,
            richestTotal: richest ? (richest.balance + richest.bank).toFixed(2) : '0.00'
        });
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stats' });
    }
});

// Leaderboard
app.get('/api/leaderboard', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const users = await User.find({ guildId }).sort({ balance: -1 }).limit(10);
        res.json(users.map(u => ({
            userId: u.userId,
            balance: u.balance,
            bank: u.bank,
            total: u.balance + u.bank
        })));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch leaderboard' });
    }
});

// Slaves list
app.get('/api/slaves', requireAuth, async (req, res) => {
    try {
        const guildId = req.session.guild.id;
        const slaves = await Slave.find({ guildId, ownerId: { $ne: null } });
        res.json(slaves.map(s => ({
            userId: s.userId,
            ownerId: s.ownerId,
            debt: s.debt,
            totalEarned: s.totalEarned
        })));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch slaves' });
    }
});

// Stocks
app.get('/api/stocks', requireAuth, async (req, res) => {
    try {
        const stocks = await Stock.find({});
        res.json(stocks.map(s => ({
            ticker: s.ticker,
            name: s.name,
            price: s.price,
            history: s.history?.slice(-10) || []
        })));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch stocks' });
    }
});

// Owner actions
app.post('/api/action/reset-cooldowns', requireAuth, async (req, res) => {
    // Signal the bot via a shared DB flag or just respond — bot reads this
    res.json({ success: true, message: 'Cooldowns cleared (restart bot to apply in-memory reset)' });
});

app.post('/api/action/jackpot', requireAuth, express.json(), async (req, res) => {
    const { amount, userId } = req.body;
    if (!amount || !userId) return res.status(400).json({ error: 'Missing fields' });
    try {
        const guildId = req.session.guild.id;
        const user = await User.findOne({ userId, guildId });
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.balance += parseFloat(amount);
        await user.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

app.post('/api/action/set-balance', requireAuth, express.json(), async (req, res) => {
    const { userId, amount } = req.body;
    if (!userId || amount === undefined) return res.status(400).json({ error: 'Missing fields' });
    try {
        const guildId = req.session.guild.id;
        const user = await User.findOne({ userId, guildId });
        if (!user) return res.status(404).json({ error: 'User not found' });
        user.balance = parseFloat(amount);
        await user.save();
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: 'Failed' });
    }
});

// ─── Helpers ──────────────────────────────────────────────────────
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

// ─── Start ────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Dashboard running on http://localhost:${PORT}`));