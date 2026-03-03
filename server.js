const express = require("express");
const mongoose = require("mongoose");
const bodyParser = require("body-parser");
const session = require("express-session");
const bcrypt = require("bcryptjs");
const User = require("./models/User");
const Menu = require("./models/Menu");
const Order = require("./models/Order");
const QRCode = require("qrcode");
const Coupon = require("./models/Coupon");

const app = express();
app.use(express.static("public"));

// View engine
app.set("view engine", "ejs");

// MongoDB connection
mongoose.connect("mongodb+srv://quickbite:quickbite123@cluster0.ekukylz.mongodb.net/quickbiteDB?retryWrites=true&w=majority")
.then(() => console.log("MongoDB Connected ✅"))
.catch(err => console.log(err));

// Middlewares
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: "quickbiteSecret",
    resave: false,
    saveUninitialized: false
}));

// Home
app.get("/", (req, res) => {
    res.render("index");
});
// Register page
app.get("/register", (req, res) => {
    res.render("register");
});

// Register logic
app.post("/register", async (req, res) => {

    const { name, email, password, role } = req.body;

    const existingUser = await User.findOne({ email });
    if (existingUser) {
        return res.send("User already exists ❌");
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({
        name,
        email,
        password: hashedPassword,
        role
    });

    await newUser.save();

    res.redirect("/login");
});

// Login page
app.get("/login", (req, res) => {
    res.render("login");
});

// Login logic
app.post("/login", async (req, res) => {

    const { email, password } = req.body;

    const user = await User.findOne({ email });

    if (!user) {
    return res.render("error", {
        message: "User not found ❌",
        backLink: "/login"
    });
}

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
    return res.render("error", {
        message: "Incorrect password ❌",
        backLink: "/login"
    });
}

    req.session.user = user;

    res.redirect("/dashboard");
});

// Dashboard
app.get("/dashboard", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    const orders = await Order.find({ userId: req.session.user._id });

    const totalOrders = orders.length;

    const totalSpent = orders.reduce((sum, order) => sum + order.totalAmount, 0);

    const activeOrders = orders.filter(order =>
        order.status === "Pending" || order.status === "Preparing"
    ).length;

    const avgOrder = totalOrders > 0 ? (totalSpent / totalOrders) : 0;

    res.render("dashboard", {
        user: req.session.user,
        totalOrders,
        totalSpent,
        activeOrders,
        avgOrder
    });
});

// Logout
app.get("/logout", (req, res) => {
    req.session.destroy();
    res.redirect("/login");
});

app.get("/add-sample-menu", async (req, res) => {

    await Menu.deleteMany(); // clear old data

    await Menu.insertMany([
        { name: "Veg Burger", description: "Delicious veg burger", price: 50, category: "Snacks" },
        { name: "Pizza", description: "Cheesy pizza", price: 120, category: "Snacks" },
        { name: "Cold Coffee", description: "Chilled coffee", price: 60, category: "Beverage" }
    ]);

    res.send("Sample menu added ✅");
});
app.get("/menu", async (req, res) => {
    if (!req.session.user) {
        return res.redirect("/login");
    }

    const items = await Menu.find(); // or whatever your model name is

    res.render("menu", { 
        user: req.session.user,
        items 
    });
});

app.post("/add-to-cart", async (req, res) => {

    if (!req.session.cart) {
        req.session.cart = [];
    }

    const item = await Menu.findById(req.body.id);

    const existingItem = req.session.cart.find(i => i.id == item._id);

    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        req.session.cart.push({
            id: item._id,
            name: item.name,
            price: item.price,
            quantity: 1
        });
    }

    res.redirect("/menu");
});

app.get("/cart", (req, res) => {

    const cart = req.session.cart || [];

    let total = 0;

    cart.forEach(item => {
        total += item.price * item.quantity;
    });

    let discountAmount = 0;

    if (req.session.discount) {
        discountAmount = (total * req.session.discount) / 100;
        total = total - discountAmount;
    }

    res.render("cart", { 
        cart,
        total,
        discountAmount   // ✅ VERY IMPORTANT
    });

});

app.post("/remove-item", (req, res) => {

    const cart = req.session.cart || [];

    req.session.cart = cart.filter(item => item.id != req.body.id);

    res.redirect("/cart");
});

app.post("/checkout", (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    const cart = req.session.cart || [];

    if (cart.length === 0) {
        return res.redirect("/cart");
    }

    let total = 0;

    cart.forEach(item => {
        total += item.price * item.quantity;
    });

    if (req.session.discount) {
        total = total - (total * req.session.discount) / 100;
    }

    // Store temporary payment data in session
    req.session.paymentData = {
        total,
        pickupTime: req.body.pickupTime
    };

    res.redirect("/payment");
});

app.get("/order/:id", async (req, res) => {

    const order = await Order.findById(req.params.id);

    const qrData = `Order ID: ${order._id} | Amount: ₹${order.totalAmount}`;

    const qrImage = await QRCode.toDataURL(qrData);

    res.render("order", { order, qrImage });
});

app.get("/orders", async (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    const orders = await Order.find({ userId: req.session.user._id });

    res.render("orders", { orders });
});

app.get("/staff", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "staff") {
        return res.send("Access Denied ❌");
    }

    const orders = await Order.find();

    res.render("staff", { orders });
});

app.post("/update-status", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "staff") {
        return res.send("Access Denied ❌");
    }

    await Order.findByIdAndUpdate(req.body.id, {
        status: req.body.status
    });

    res.redirect("/staff");
});

app.get("/admin", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.send("Access Denied ❌");
    }

    const menuItems = await Menu.find();
    const users = await User.find();
    const coupons = await Coupon.find();

    res.render("admin", { 
        menuItems, 
        users,
        coupons
    });
});

app.post("/add-menu", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.send("Access Denied ❌");
    }

    const { name, description, price, category } = req.body;

    await Menu.create({
        name,
        description,
        price,
        category
    });

    res.redirect("/admin");
});

app.post("/delete-menu", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.send("Access Denied ❌");
    }

    await Menu.findByIdAndDelete(req.body.id);

    res.redirect("/admin");
});

app.post("/cancel-order", async (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    const order = await Order.findById(req.body.id);

    if (!order) {
        return res.send("Order not found");
    }

    // Only allow cancellation if Pending or Preparing
    if (order.status === "Pending") {

    order.status = "Cancelled";
    await order.save();

    return res.redirect("/orders");
}

    res.render("error", {
        message: "Order cannot be cancelled at this stage ❌",
        backLink: "/orders"
    });

});

app.post("/apply-coupon", async (req, res) => {

    const coupon = await Coupon.findOne({ 
        code: req.body.code.toUpperCase(),
        active: true
    });

    if (!coupon) {
        return res.render("error", {
            message: "Invalid Coupon Code ❌",
            backLink: "/cart"
        });
    }

    req.session.discount = coupon.discount;

    res.redirect("/cart");
});

app.get("/monthly-report", async (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    const userId = req.session.user._id;

    const selectedMonth = req.query.month 
        ? new Date(req.query.month) 
        : new Date();

    const start = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth(), 1);
    const end = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 1);

    const orders = await Order.find({
        userId,
        createdAt: { $gte: start, $lt: end }
    });

    let totalSpent = 0;

    orders.forEach(order => {
        totalSpent += order.totalAmount;
    });

    res.render("monthly-report", {
        orders,
        totalSpent,
        totalOrders: orders.length,
        selectedMonth
    });

});

app.post("/add-coupon", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.send("Access Denied ❌");
    }

    const { code, discount } = req.body;

    await Coupon.create({
        code: code.toUpperCase(),
        discount: Number(discount),
        active: true
    });

    res.redirect("/admin");
});

app.post("/delete-coupon", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.send("Access Denied ❌");
    }

    await Coupon.findByIdAndDelete(req.body.id);

    res.redirect("/admin");
});

app.get("/profile", (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    res.render("profile", { user: req.session.user });

});

app.post("/update-profile", async (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    const { name, email } = req.body;

    await User.findByIdAndUpdate(req.session.user._id, {
        name,
        email
    });

    // Update session data
    req.session.user.name = name;
    req.session.user.email = email;

    res.redirect("/profile");
});

app.post("/change-password", async (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.session.user._id);

    const isMatch = await bcrypt.compare(currentPassword, user.password);

    if (!isMatch) {
        return res.render("error", {
            message: "Current password incorrect ❌",
            backLink: "/profile"
        });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);

    user.password = hashedPassword;
    await user.save();

    res.render("error", {
        message: "Password changed successfully ✅",
        backLink: "/profile"
    });
});

app.get("/payment", (req, res) => {

    if (!req.session.user || !req.session.paymentData) {
        return res.redirect("/cart");
    }

    res.render("payment", {
        total: req.session.paymentData.total
    });

});

app.post("/process-payment", async (req, res) => {

    if (!req.session.user || !req.session.paymentData) {
        return res.redirect("/cart");
    }

    const cart = req.session.cart || [];

    const newOrder = new Order({
        userId: req.session.user._id,
        items: cart,
        totalAmount: req.session.paymentData.total,
        pickupTime: req.session.paymentData.pickupTime
    });

    await newOrder.save();

    // Clear session data
    req.session.cart = [];
    req.session.discount = null;
    req.session.paymentData = null;

    res.redirect("/order/" + newOrder._id);
});

app.get("/admin/add-item", (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.redirect("/dashboard");
    }

    res.render("addItem");
});

app.post("/admin/add-item", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.redirect("/dashboard");
    }

    const newItem = new Menu({
        name: req.body.name,
        description: req.body.description,
        price: req.body.price,
        emoji: req.body.emoji,
        category: req.body.category,
        rating: 4.5,
        time: 10
    });

    await newItem.save();

    res.redirect("/menu");
});
// Server
const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});