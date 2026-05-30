const mongoose = require('mongoose');
const configSchema = new mongoose.Schema({
  guildId: { type: String, required: true, unique: true },
  allowedChannels: { type: [String], default: [] }
});
module.exports = mongoose.model('Config', configSchema);