const fetch = require('node-fetch');
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
const STREAK_MILESTONES = { 10: 15000, 25: 40000, 50: 100000, 75: 200000, 100: 500000 };

async function sendDM(userId, embed) {
    try {
        const channelRes = await fetch('https://discord.com/api/v10/users/@me/channels', {
            method: 'POST',
            headers: {
                Authorization: `Bot ${process.env.BOT_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ recipient_id: userId }),
        });
        const channel = await channelRes.json();
        if (!channel.id) return;
        await fetch(`https://discord.com/api/v10/channels/${channel.id}/messages`, {
            method: 'POST',
            headers: {
                Authorization: `Bot ${process.env.BOT_TOKEN}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ embeds: [embed] }),
        });
    } catch {}
}

function registerVoteWebhook(app) {

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

            const onCooldown = vd.lastVoted && (now - vd.lastVoted) < VOTE_COOLDOWN;
            if (onCooldown) return;

            const withinStreakWindow = vd.lastVoted && (now - vd.lastVoted) < STREAK_WINDOW;
            vd.totalVotes += 1;
            vd.voteStreak = withinStreakWindow ? vd.voteStreak + 1 : 1;
            vd.lastVoted = now;
            vd.tier = vd.totalVotes;
            await vd.save();

            const streakBonus = STREAK_MILESTONES[vd.voteStreak] || null;

            if (streakBonus) {
                try {
                    const User = require('./models/User');
                    const user = await User.findOne({ userId });
                    if (user) {
                        user.balance += streakBonus;
                        await user.save();
                    }
                } catch {}
            }

            const dmLines = [
                `Your vote has been registered. You are now **Tier ${vd.tier}**.`,
                `Total votes: **${vd.totalVotes}** - Streak: **${vd.voteStreak}**`,
                '',
                'Use **/vote claim** in Discord to collect your rewards.',
            ];

            if (streakBonus) {
                dmLines.push('');
                dmLines.push(`**${vd.voteStreak} Vote Streak Bonus** - $${streakBonus.toLocaleString()} added to your account.`);
            }

            await sendDM(userId, {
                title: '🗳️ Vote Received',
                description: dmLines.join('\n'),
                color: 0xFFD700,
                footer: { text: 'Economic Bomb - Vote Battlepass' },
            });

        } catch (err) {
            console.error('Vote webhook error:', err);
        }
    });
}

module.exports = { registerVoteWebhook };
