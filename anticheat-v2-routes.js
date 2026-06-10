const User = require('./models/User');

let AnticheatLog;
try {
    AnticheatLog = require('./models/AnticheatLog');
} catch {
    const mongoose = require('mongoose');
    const anticheatLogSchema = new mongoose.Schema({
        userId:        { type: String, required: true, index: true },
        type:          { type: String, required: true },
        detail:        { type: String, required: true },
        severity:      { type: String, enum: ['critical', 'warning'], default: 'warning' },
        balanceBefore: { type: Number, default: 0 },
        bankBefore:    { type: Number, default: 0 },
        balanceAfter:  { type: Number, default: null },
        bankAfter:     { type: Number, default: null },
        autoFixed:     { type: Boolean, default: false },
        dismissed:     { type: Boolean, default: false },
        timestamp:     { type: Number, default: Date.now },
    });
    AnticheatLog = mongoose.models.AnticheatLog || mongoose.model('AnticheatLog', anticheatLogSchema);
}

function registerAnticheatV2Routes(app) {

    app.get('/api/anticheat', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
        try {
            const logs = await AnticheatLog.find({ dismissed: false }).sort({ timestamp: -1 }).limit(200).lean();
            res.json(logs);
        } catch (err) {
            res.status(500).json({ error: 'Failed' });
        }
    });

    app.post('/api/anticheat/dismiss', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
        const { id } = req.body;
        if (!id) return res.status(400).json({ error: 'Missing id' });
        try {
            await AnticheatLog.findByIdAndUpdate(id, { dismissed: true });
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed' });
        }
    });

    app.post('/api/action/wipe-balance', async (req, res) => {
        if (!req.session.user) return res.status(401).json({ error: 'Unauthorized' });
        const { userId } = req.body;
        if (!userId) return res.status(400).json({ error: 'Missing userId' });
        try {
            const user = await User.findOne({ userId });
            if (!user) return res.status(404).json({ success: false, error: 'User not found' });

            const balBefore = user.balance;
            const bankBefore = user.bank;
            user.balance = 0;
            user.bank = 0;
            await user.save();

            await AnticheatLog.create({
                userId,
                type: 'manual_wipe',
                detail: `Manual balance wipe by dashboard admin`,
                severity: 'critical',
                balanceBefore: balBefore,
                bankBefore,
                balanceAfter: 0,
                bankAfter: 0,
                autoFixed: true,
                dismissed: false,
                timestamp: Date.now(),
            });

            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ success: false, error: 'Failed' });
        }
    });

}

module.exports = { registerAnticheatV2Routes };
