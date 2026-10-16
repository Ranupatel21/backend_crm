// Seeds the database with an initial super_admin, a manager, a sales employee and a couple of sample leads.
// Run with: npm run seed
import dotenv from "dotenv";
import { connectDB } from "../config/db.js";
import User from "../models/User.js";
import Lead from "../models/Lead.js";
import mongoose from "mongoose";

dotenv.config();
console.log("MONGO_URI:", process.env.MONGO_URI);
const run = async () => {
  await connectDB();

  await User.deleteMany({});
  await Lead.deleteMany({});

  const admin = await User.create({
    name: "HYCO Admin", email: "admin@hyco.com", password: "admin123",
    role: "super_admin", phone: "9999900000",
  });
  const manager = await User.create({
    name: "Rohit Manager", email: "manager@hyco.com", password: "manager123",
    role: "manager", phone: "9999900001",
  });
  const employee = await User.create({
    name: "Ranu Sales", email: "ranu@hyco.com", password: "sales123",
    role: "sales_employee", phone: "9999900002",
  });

  await Lead.create([
    {
      name: "Rahul Sharma", phone: "9876543210", email: "rahul@example.com",
      leadSource: "WhatsApp", state: "Madhya Pradesh", product: "HYCO Fabric Whitener",
      quantity: "5 units", city: "Indore", priority: "High", status: "Contacted",
      assignedTo: employee._id, createdBy: admin._id, notes: "Interested in bulk order",
    },
    {
      name: "Priya Verma", phone: "9123456780", leadSource: "Facebook",
      state: "Maharashtra", city: "Pune", priority: "Medium", status: "New",
      createdBy: admin._id,
    },
  ]);

  console.log("Seed data created:");
  console.log("  super_admin -> admin@hyco.com / admin123");
  console.log("  manager     -> manager@hyco.com / manager123");
  console.log("  sales_employee -> ranu@hyco.com / sales123");

  await mongoose.connection.close();
  process.exit(0);
};

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
