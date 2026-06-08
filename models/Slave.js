const mongoose = require('mongoose');

const slaveSchema = new mongoose.Schema({
    userId: { type: String, required: true, unique: true },
    ownerId: { type: String, default: null },
    debt: { type: Number, default: 0 },
    totalEarned: { type: Number, default: 0 },
});

module.exports = mongoose.model('Slave', slaveSchema);
