const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema({
    guildId: { type: String, required: true },
    ticker: { type: String, required: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    history: { type: [Number], default: [] },
    totalShares: { type: Number, default: 0 }
});

stockSchema.index({ guildId: 1, ticker: 1 }, { unique: true });

module.exports = mongoose.model('Stock', stockSchema);
