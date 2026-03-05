const mongoose = require("mongoose");

const orderSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
        required: true
    },
    items: {
        type: Array,
        default: []
    },
    totalAmount: {
        type: Number,
        required: true,
        min: 0
    },
    pickupTime: {
        type: String,
        required: true
    },
    status: {
    type: String,
    default: "Pending",
    enum: ["Pending", "Preparing", "Ready", "Completed", "Cancelled"]
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model("Order", orderSchema);