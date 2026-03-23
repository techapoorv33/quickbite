const mongoose = require("mongoose");

const menuSchema = new mongoose.Schema({
    name: String,
    price: Number,
    category: String,
    description: String,
    emoji: String,
    // Image URL to display in menu cards (admin/staff can set this)
    imageUrl: {
        type: String,
        default: ""
    },
    rating: {
        type: Number,
        default: 4.5,
        min: 1,
        max: 5
    },
    prepTime: Number,
    available: {
        type: Boolean,
        default: true
    }
});

module.exports = mongoose.model("Menu", menuSchema);