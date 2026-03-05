const mongoose = require("mongoose");

const menuSchema = new mongoose.Schema({
    name: String,
    price: Number,
    category: String,
    description: String,
    emoji: String,
    rating: {
        type: Number,
        default: 4.5
    },
    prepTime: Number,
    available: {
        type: Boolean,
        default: true
    }
});

module.exports = mongoose.model("Menu", menuSchema);