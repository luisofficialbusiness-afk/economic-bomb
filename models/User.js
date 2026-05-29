const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    userId: String,
    guildId: String,
    balance: { type: Number, default: 0 },
    bank: { type: Number, default: 0 },
    lastWork: { type: Number, default: 0 },
    lastRob: { type: Number, default: 0 }
});

module.exports = mongoose.model('User', userSchema);
