const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    userId:              { type: String, unique: true },
    balance:             { type: Number, default: 0 },
    bank:                { type: Number, default: 0 },
    lastWork:            { type: Number, default: 0 },
    lastRob:             { type: Number, default: 0 },
    lastDaily:           { type: Number, default: 0 },
    dailyStreak:         { type: Number, default: 0 },
    gamblingWinnings:    { type: Number, default: 0 },
    gamblingBoostExpires:{ type: Number, default: 0 },
    inventory:           [{ item: String, quantity: { type: Number, default: 1 } }],
    dmOptOut:            { type: Boolean, default: false },
    prestige:            { type: Number, default: 0 },
    prestigeMultiplier:  { type: Number, default: 1 },
    jobId:               { type: String,  default: null },
    jobMultiplier:       { type: Number, default: 1 },
    fishBucket:          [{ item: String, weight: Number, quantity: Number }],
    fishRodDurability:   { type: Number, default: 0 },
    lastFishCast:        { type: Number, default: 0 },
    pickaxeDurability:   { type: Number, default: 0 },
});

module.exports = mongoose.model('User', userSchema);
