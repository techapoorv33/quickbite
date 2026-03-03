const mongoose = require("mongoose");

const couponSchema = new mongoose.Schema({
    code: String,
    discount: Number, // percentage
    active: {
        type: Boolean,
        default: true
    }
});

module.exports = mongoose.model("Coupon", couponSchema);