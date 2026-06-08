const User = require('./models/User');
const Slave = require('./models/Slave');
const Stock = require('./models/Stock');

const MAX_BALANCE = 999_999_999_999_999;

function registerFixedRoutes(app) {

    app.get('/api/anticheat', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const users = await User.find({}).lean();
            const flags = [];

            for (const u of users) {
                const total = (u.balance || 0) + (u.bank || 0);

                if (total > MAX_BALANCE) {
                    flags.push({ userId: u.userId, type: 'max_balance', detail: `$${total.toLocaleString()} exceeds hard cap`, severity: 'high', balance: u.balance, bank: u.bank });
                    continue;
                }

                if (isNaN(u.balance) || isNaN(u.bank)) {
                    flags.push({ userId: u.userId, type: 'nan_balance', detail: `Balance or bank is NaN`, severity: 'high', balance: u.balance, bank: u.bank });
                    continue;
                }

                if (u.balance < 0) {
                    flags.push({ userId: u.userId, type: 'negative_wallet', detail: `Wallet is $${u.balance.toLocaleString()}`, severity: 'high', balance: u.balance, bank: u.bank });
                    continue;
                }

                if (u.bank < 0) {
                    flags.push({ userId: u.userId, type: 'negative_bank', detail: `Bank is $${u.bank.toLocaleString()}`, severity: 'high', balance: u.balance, bank: u.bank });
                    continue;
                }

                if (total > 500_000_000_000) {
                    flags.push({ userId: u.userId, type: 'high_net_worth', detail: `$${total.toLocaleString()} net worth - verify legitimacy`, severity: 'medium', balance: u.balance, bank: u.bank });
                }
            }

            res.json(flags);
        } catch (err) {
            res.status(500).json({ error: 'Failed' });
        }
    });

    app.get('/api/stats', async (req, res) => {
        if (!req.session.user || !req.session.guild) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const guildId = req.session.guild.id;
            const users = await User.find({}).lean();
            const slaves = await Slave.find({ ownerId: { $ne: null } }).lean();

            const totalWallet = users.reduce((a, u) => a + (u.balance || 0), 0);
            const totalBank = users.reduce((a, u) => a + (u.bank || 0), 0);
            const sorted = [...users].sort((a, b) => (b.balance + b.bank) - (a.balance + a.bank));
            const richest = sorted[0];
            const brokest = sorted[sorted.length - 1];
            const totalDebt = slaves.reduce((a, s) => a + (s.debt || 0), 0);
            const totalSlaveEarned = slaves.reduce((a, s) => a + (s.totalEarned || 0), 0);
            const ownerCounts = {};
            for (const s of slaves) ownerCounts[s.ownerId] = (ownerCounts[s.ownerId] || 0) + 1;
            const topOwner = Object.entries(ownerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

            const stocks = await Stock.find({ guildId }).lean();

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
                topOwner,
                totalStocks: stocks.length,
            });
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch stats' });
        }
    });

    app.get('/api/leaderboard', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const users = await User.find({}).sort({ balance: -1 }).limit(20).lean();
            const slaves = await Slave.find({ ownerId: { $ne: null } }).lean();
            const slaveIds = new Set(slaves.map(s => s.userId));
            res.json(users.map(u => ({
                userId: u.userId,
                balance: u.balance,
                bank: u.bank,
                total: u.balance + u.bank,
                prestige: u.prestige || 0,
                isEnslave: slaveIds.has(u.userId),
            })));
        } catch (err) {
            res.status(500).json({ error: 'Failed to fetch leaderboard' });
        }
    });

    app.get('/api/health', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const users = await User.find({}).lean();
            const slaves = await Slave.find({ ownerId: { $ne: null } }).lean();
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
                if (topShare > 0.4) { score -= 15; issues.push({ type: 'warn', msg: `Top player holds ${(topShare * 100).toFixed(0)}% of all money` }); }
            }
            if (users.length < 3) { score -= 10; issues.push({ type: 'info', msg: 'Less than 3 registered players' }); }
            if (users.length > 0 && slaves.length / users.length > 0.3) {
                score -= 15; issues.push({ type: 'warn', msg: `${(slaves.length / users.length * 100).toFixed(0)}% of players are enslaved` });
            }

            const nanUsers = users.filter(u => isNaN(u.balance) || isNaN(u.bank));
            if (nanUsers.length > 0) { score -= 25; issues.push({ type: 'warn', msg: `${nanUsers.length} player${nanUsers.length !== 1 ? 's' : ''} with NaN balance - check anticheat` }); }

            const negUsers = users.filter(u => u.balance < 0 || u.bank < 0);
            if (negUsers.length > 0) { score -= 20; issues.push({ type: 'warn', msg: `${negUsers.length} player${negUsers.length !== 1 ? 's' : ''} with negative balance - check anticheat` }); }

            const grade = score >= 85 ? 'Healthy' : score >= 65 ? 'Fair' : score >= 45 ? 'Poor' : 'Critical';
            const color = score >= 85 ? 'green' : score >= 65 ? 'yellow' : 'red';
            res.json({ score: Math.max(0, score), grade, color, issues });
        } catch (err) {
            res.status(500).json({ error: 'Failed' });
        }
    });

    app.post('/api/action/set-balance', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
        const { userId, amount } = req.body;
        if (!userId || amount === undefined) return res.status(400).json({ error: 'Missing fields' });
        try {
            const user = await User.findOne({ userId });
            if (!user) return res.status(404).json({ success: false, error: 'User not found' });
            user.balance = parseFloat(amount);
            await user.save();
            res.json({ success: true });
        } catch { res.status(500).json({ success: false, error: 'Failed' }); }
    });

    app.post('/api/action/set-bank', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
        const { userId, amount } = req.body;
        if (!userId || amount === undefined) return res.status(400).json({ error: 'Missing fields' });
        try {
            const user = await User.findOne({ userId });
            if (!user) return res.status(404).json({ success: false, error: 'User not found' });
            user.bank = parseFloat(amount);
            await user.save();
            res.json({ success: true });
        } catch { res.status(500).json({ success: false, error: 'Failed' }); }
    });

    app.post('/api/action/jackpot', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
        const { amount, userId } = req.body;
        if (!amount || !userId) return res.status(400).json({ error: 'Missing fields' });
        try {
            const user = await User.findOne({ userId });
            if (!user) return res.status(404).json({ success: false, error: 'User not found' });
            user.balance += parseFloat(amount);
            await user.save();
            res.json({ success: true });
        } catch { res.status(500).json({ success: false, error: 'Failed' }); }
    });
}

module.exports = { registerFixedRoutes };
