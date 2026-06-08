const mongoose = require('mongoose');

const portfolioSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    holdings: [
        {
            ticker: String,
            shares: Number,
            avgBuyPrice: Number
        }
    ]
});

module.exports = mongoose.model('Portfolio', portfolioSchema);
