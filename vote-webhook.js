const mongoose = require('mongoose');

const voteSchema = new mongoose.Schema({
    userId:       { type: String, required: true, unique: true },
    totalVotes:   { type: Number, default: 0 },
    voteStreak:   { type: Number, default: 0 },
    lastVoted:    { type: Number, default: 0 },
    tier:         { type: Number, default: 0 },
    tierProgress: { type: Number, default: 0 },
    claimedTiers: { type: [Number], default: [] },
});

const VoteModel = mongoose.models.Vote || mongoose.model('Vote', voteSchema);

const VOTE_COOLDOWN = 12 * 60 * 60 * 1000;
const STREAK_WINDOW = 36 * 60 * 60 * 1000;

function registerVoteWebhook(app, client) {

    app.post('/api/vote/webhook', async (req, res) => {
        const auth = req.headers.authorization;
        if (auth !== process.env.TOPGG_WEBHOOK_SECRET)
            return res.status(403).json({ error: 'Unauthorized' });

        const { user: userId, type } = req.body;
        if (!userId || type !== 'upvote')
            return res.status(400).json({ error: 'Invalid payload' });

        res.status(200).json({ success: true });

        try {
            const now = Date.now();
            let vd = await VoteModel.findOne({ userId });
            if (!vd) vd = new VoteModel({ userId });

            const withinStreakWindow = vd.lastVoted && (now - vd.lastVoted) < STREAK_WINDOW;
            const onCooldown = vd.lastVoted && (now - vd.lastVoted) < VOTE_COOLDOWN;

            if (onCooldown) return;

            vd.totalVotes += 1;
            vd.voteStreak = withinStreakWindow ? vd.voteStreak + 1 : 1;
            vd.lastVoted = now;
            vd.tier = vd.totalVotes;
            await vd.save();

            const streakMilestones = { 10: 15000, 25: 40000, 50: 100000, 75: 200000, 100: 500000 };
            const streakBonus = streakMilestones[vd.voteStreak] || null;

            let dmLines = [
                `Your vote has been registered. You are now **Tier ${vd.tier}**.`,
                `Total votes: **${vd.totalVotes}** - Streak: **${vd.voteStreak}**`,
                '',
                'Use **/vote claim** to collect your rewards.',
            ];

            if (streakBonus) {
                dmLines.push('');
                dmLines.push(`**${vd.voteStreak} Vote Streak Bonus** - $${streakBonus.toLocaleString()} added to your account.`);

                try {
                    const User = require('./models/User');
                    const user = await User.findOne({ userId });
                    if (user) {
                        user.balance += streakBonus;
                        await user.save();
                    }
                } catch {}
            }

            try {
                const discordUser = await client.users.fetch(userId);
                await discordUser.send({
                    embeds: [{
                        title: '🗳️ Vote Received',
                        description: dmLines.join('\n'),
                        color: 0xFFD700,
                        footer: { text: 'Economic Bomb - Vote Battlepass' },
                    }]
                });
            } catch {}

        } catch (err) {
            console.error('Vote webhook processing error:', err);
        }
    });
}

module.exports = { registerVoteWebhook };
