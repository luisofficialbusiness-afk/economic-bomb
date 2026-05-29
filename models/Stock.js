const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema({
    ticker: { type: String, required: true, unique: true },
    name: { type: String, required: true },
    price: { type: Number, required: true },
    history: { type: [Number], default: [] },
    totalShares: { type: Number, default: 0 }
});

module.exports = mongoose.model('Stock', stockSchema);
