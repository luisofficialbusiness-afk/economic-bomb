const mongoose = require('mongoose');

const ConfigSchema = new mongoose.Schema({
    guildId: { type: String, required: true, unique: true },
    allowedChannels: { type: [String], default: [] },
    bannedUsers: {
        type: [{
            userId: String,
            reason: String,
            bannedAt: { type: Date, default: Date.now }
        }],
        default: []
    },
    modules: {
        type: {
            work:        { type: Boolean, default: true },
            rob:         { type: Boolean, default: true },
            coinflip:    { type: Boolean, default: true },
            dice:        { type: Boolean, default: true },
            slots:       { type: Boolean, default: true },
            duel:        { type: Boolean, default: true },
            stocks:      { type: Boolean, default: true },
            slave:       { type: Boolean, default: true },
            givemoney:   { type: Boolean, default: true },
            deposit:     { type: Boolean, default: true },
            withdraw:    { type: Boolean, default: true },
            leaderboard: { type: Boolean, default: true }
        },
        default: {}
    }
});

module.exports = mongoose.models.Config || mongoose.model('Config', ConfigSchema);