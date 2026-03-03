const mongoose = require("mongoose");

const menuSchema = new mongoose.Schema({
    name: String,
    description: String,
    price: Number,
    emoji: String,
    rating: Number,
    time: Number,
    category: String   // 🔥 IMPORTANT
});

module.exports = mongoose.model("Menu", menuSchema);