require("dotenv").config();
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
const Feedback = require("./models/Feedback");

const app = express();
app.use(express.static("public"));

// View engine
app.set("view engine", "ejs");

// MongoDB connection
mongoose.connect(process.env.MONGO_URI)
.then(async () => {
    console.log("MongoDB Connected ✅");
    try {
        await normalizeExistingEmails();
        await ensureDemoUsers();
    } catch (e) {
        console.error("Demo user seed failed:", e);
    }
})
.catch(err => console.log(err));

// Middlewares
app.use(bodyParser.urlencoded({ extended: true }));
app.use(session({
    secret: process.env.SESSION_SECRET || "quickbiteSecret",
    resave: false,
    saveUninitialized: false
}));

function normalizeEmail(email) {
    return String(email || "").trim().toLowerCase();
}

function homeForUser(user) {
    const role = user?.role;
    if (role === "admin") return "/admin";
    if (role === "staff") return "/staff";
    return "/dashboard";
}

function sessionUserFromDb(userDoc) {
    return {
        _id: userDoc._id,
        name: userDoc.name,
        email: userDoc.email,
        role: userDoc.role,
        monthlyExpense: userDoc.monthlyExpense || 0
    };
}

function requireLogin(req, res, next) {
    if (!req.session.user) return res.redirect("/login");
    return next();
}

function requireRoles(...roles) {
    return (req, res, next) => {
        if (!req.session.user) return res.redirect("/login");
        if (!roles.includes(req.session.user.role)) return res.redirect(homeForUser(req.session.user));
        return next();
    };
}

async function ensureDemoUsers() {
    const demoUsers = [
        { name: "Demo Student", email: "student@quickbite.com", role: "student" },
        { name: "Demo Staff", email: "staff@quickbite.com", role: "staff" },
        { name: "Demo Admin", email: "admin@quickbite.com", role: "admin" }
    ];

    for (const demo of demoUsers) {
        const email = normalizeEmail(demo.email);
        const exists = await User.findOne({ email });
        if (exists) continue;
        const hashedPassword = await bcrypt.hash("password", 10);
        await User.create({ name: demo.name, email, password: hashedPassword, role: demo.role });
    }
}

async function normalizeExistingEmails() {
    // Fix legacy users where email was saved with spaces/uppercase.
    // Do it per-document to avoid update-pipeline restrictions.
    const users = await User.find({ email: { $type: "string" } }, { _id: 1, email: 1 }).lean();
    for (const u of users) {
        const normalized = normalizeEmail(u.email);
        if (!normalized || normalized === u.email) continue;
        try {
            await User.updateOne({ _id: u._id }, { $set: { email: normalized } });
        } catch (e) {
            // If duplicate keys exist due to differing casing/whitespace, skip normalization for that record.
            if (e && e.code === 11000) continue;
            throw e;
        }
    }
}

// Home
app.get("/", (req, res) => {
    if (req.session.user) return res.redirect(homeForUser(req.session.user));
    res.render("index");
});
// Register page
app.get("/register", (req, res) => {
    res.render("register");
});

// Register logic
app.post("/register", async (req, res) => {

    try {
        const name = String(req.body.name || "").trim();
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");

        if (!name || !email || !password) {
            return res.render("error", { message: "All fields are required ❌", backLink: "/register" });
        }

        const existingUser = await User.findOne({ email });
        if (existingUser) {
            return res.render("error", { message: "Email already registered ❌", backLink: "/login" });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        const newUser = await User.create({
            name,
            email,
            password: hashedPassword,
            role: "student"
        });

        // Auto-login after registration
        req.session.user = sessionUserFromDb(newUser);
        res.redirect("/dashboard");
    } catch (err) {
        if (err && err.code === 11000) {
            return res.render("error", { message: "Email already registered ❌", backLink: "/login" });
        }
        console.error("Register error:", err);
        res.render("error", { message: "Registration failed ❌", backLink: "/register" });
    }
});

// Login page
app.get("/login", (req, res) => {
    res.render("login");
});

// Login logic
app.post("/login", async (req, res) => {

    try {
        const email = normalizeEmail(req.body.email);
        const password = String(req.body.password || "");

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

        req.session.user = sessionUserFromDb(user);

        res.redirect(homeForUser(user));
    } catch (err) {
        console.error("Login error:", err);
        res.render("error", { message: "Login failed ❌", backLink: "/login" });
    }
});

// Dashboard
app.get("/dashboard", async (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "student") return res.redirect(homeForUser(req.session.user));

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
    if (!req.session.user || req.session.user.role !== "admin") {
        return res.send("Access Denied ❌");
    }

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

    const items = (req.session.user.role === "staff" || req.session.user.role === "admin")
        ? await Menu.find()
        : await Menu.find({ available: true });

    res.render("menu", { 
        user: req.session.user,
        items 
    });
});

app.post("/add-to-cart", requireLogin, async (req, res) => {

    if (!req.session.cart) {
        req.session.cart = [];
    }

    const item = await Menu.findById(req.body.id);
    if (!item) return res.redirect("/menu");
    if (item.available === false) {
        return res.render("error", { message: "Item is currently unavailable ❌", backLink: "/menu" });
    }

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

app.get("/cart", requireLogin, (req, res) => {

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

app.post("/remove-item", requireLogin, (req, res) => {

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
    if (!order) {
        return res.render("error", { message: "Order not found ❌", backLink: "/orders" });
    }
    if (!req.session.user) return res.redirect("/login");
    const isStaffOrAdmin = req.session.user.role === "staff" || req.session.user.role === "admin";
    if (!isStaffOrAdmin && String(order.userId) !== String(req.session.user._id)) {
        return res.render("error", { message: "Access denied ❌", backLink: "/orders" });
    }

    // QR token contains the unique order ID for staff verification
    const qrData = order._id.toString();

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

app.get("/admin", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.send("Access Denied ❌");
    }

    const menuItems = await Menu.find();
    const users = await User.find();
    const coupons = await Coupon.find();
    const feedbacks = await Feedback.find()
        .sort({ createdAt: -1 })
        .limit(20)
        .populate("userId")
        .populate("orderId");

    res.render("admin", { 
        menuItems, 
        users,
        coupons,
        feedbacks
    });
});

app.post("/admin/update-user", async (req, res) => {

    if (!req.session.user || req.session.user.role !== "admin") {
        return res.send("Access Denied ❌");
    }

    const { id, role } = req.body;
    const allowedRoles = ["student", "staff", "admin"];

    if (!allowedRoles.includes(role)) {
        return res.render("error", {
            message: "Invalid role ❌",
            backLink: "/admin"
        });
    }

    await User.findByIdAndUpdate(id, { role });

    res.redirect("/admin");
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

app.post("/apply-coupon", requireLogin, async (req, res) => {

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

app.get("/feedback/:orderId", async (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    const order = await Order.findById(req.params.orderId);

    if (!order || String(order.userId) !== String(req.session.user._id)) {
        return res.render("error", {
            message: "Order not found ❌",
            backLink: "/orders"
        });
    }

    res.render("feedback", {
        user: req.session.user,
        order
    });
});

app.post("/feedback/:orderId", async (req, res) => {

    if (!req.session.user) {
        return res.redirect("/login");
    }

    const order = await Order.findById(req.params.orderId);

    if (!order || String(order.userId) !== String(req.session.user._id)) {
        return res.render("error", {
            message: "Order not found ❌",
            backLink: "/orders"
        });
    }

    const rating = Number(req.body.rating);
    const comment = req.body.comment || "";

    if (rating < 1 || rating > 5) {
        return res.render("error", {
            message: "Rating must be between 1 and 5 ❌",
            backLink: `/feedback/${order._id}`
        });
    }

    await Feedback.create({
        userId: req.session.user._id,
        orderId: order._id,
        rating,
        comment
    });

    res.redirect("/orders");
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
        price: Number(req.body.price),
        emoji: req.body.emoji,
        category: req.body.category,
        rating: 4.5,
        prepTime: 10
    });

    await newItem.save();

    res.redirect("/menu");
});

app.get("/staff", async (req, res) => {

    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "staff") return res.redirect(homeForUser(req.session.user));

    const pending = await Order.countDocuments({status:"Pending"});
    const preparing = await Order.countDocuments({status:"Preparing"});
    const ready = await Order.countDocuments({status:"Ready"});
    const completed = await Order.countDocuments({status:"Completed"});

    res.render("staffDashboard",{
        user:req.session.user,
        pending,
        preparing,
        ready,
        completed
    });

});

app.get("/staff/orders", async (req,res)=>{

    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "staff") return res.redirect(homeForUser(req.session.user));

    const orders = await Order.find().sort({createdAt:-1});

    res.render("staffOrders",{
        user:req.session.user,
        orders
    });

});

app.get("/staff/verify", async (req, res) => {

    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "staff") return res.redirect(homeForUser(req.session.user));

    const orderId = (req.query.orderId || "").trim();
    let order = null;

    if (orderId) {
        try {
            order = await Order.findById(orderId);
        } catch (e) {
            order = null;
        }
    }

    res.render("staffVerify",{
        user:req.session.user,
        order,
        orderId
    });
});

app.post("/staff/verify", async (req, res) => {

    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "staff") return res.redirect(homeForUser(req.session.user));

    const { orderId, action } = req.body;

    if (!orderId) {
        return res.render("error", {
            message: "Order ID is required ❌",
            backLink: "/staff/verify"
        });
    }

    const order = await Order.findById(orderId.trim());

    if (!order) {
        return res.render("error", {
            message: "Order not found ❌",
            backLink: "/staff/verify"
        });
    }

    if (action === "markReady") {
        order.status = "Ready";
    } else if (action === "markCompleted") {
        order.status = "Completed";
    }

    await order.save();

    res.redirect("/staff/orders");
});

app.post("/staff/update-status", async (req,res)=>{
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "staff") return res.redirect(homeForUser(req.session.user));

    const {orderId,status} = req.body;
    const allowed = new Set(["Pending", "Preparing", "Ready", "Completed", "Cancelled"]);
    if (!allowed.has(status)) {
        return res.render("error", { message: "Invalid status ❌", backLink: "/staff/orders" });
    }

    await Order.findByIdAndUpdate(orderId,{
        status:status
    });

    res.redirect("/staff/orders");

});

app.get("/staff/menu", async (req,res)=>{
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "staff") return res.redirect(homeForUser(req.session.user));

    const items = await Menu.find();

    res.render("staffMenu",{
        user:req.session.user,
        items
    });

});

app.post("/staff/add-item", async (req,res)=>{
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "staff") return res.redirect(homeForUser(req.session.user));

    const {name,price,category,description,prepTime} = req.body;

    const newItem = new Menu({
        name,
        price: Number(price),
        category,
        description,
        prepTime: Number(prepTime)
    });

    await newItem.save();

    res.redirect("/staff/menu");

});

app.post("/staff/toggle-item", async (req,res)=>{
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.role !== "staff") return res.redirect(homeForUser(req.session.user));

    const item = await Menu.findById(req.body.id);
    if (!item) return res.redirect("/staff/menu");

    item.available = !item.available;

    await item.save();

    res.redirect("/staff/menu");

});
// Server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});