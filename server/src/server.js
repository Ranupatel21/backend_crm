import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import http from "http";
import jwt from "jsonwebtoken";
import { Server } from "socket.io";

import { connectDB } from "./config/db.js";
import { notFound, errorHandler } from "./middleware/errorHandler.js";

import User from "./models/User.js";

import authRoutes from "./routes/authRoutes.js";
import userRoutes from "./routes/userRoutes.js";
import leadRoutes from "./routes/leadRoutes.js";
import followUpRoutes from "./routes/followUpRoutes.js";
import notificationRoutes from "./routes/notificationRoutes.js";
import dashboardRoutes from "./routes/dashboardRoutes.js";
import whatsappRoutes from "./routes/whatsappRoutes.js";
import callRoutes from "./routes/callRoutes.js";

dotenv.config();

const app = express();

/* =========================
   MIDDLEWARE
========================= */

app.use(
  cors({
    origin: process.env.CLIENT_URL || "*",
    credentials: true,
  })
);

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

if (process.env.NODE_ENV !== "test") {
  app.use(morgan("dev"));
}

/* =========================
   HEALTH CHECK
========================= */

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "HYCO CRM API is running",
  });
});

/* =========================
   ROUTES
========================= */

app.use("/api/auth", authRoutes);
app.use("/api/users", userRoutes);
app.use("/api/leads", leadRoutes);
app.use("/api/followups", followUpRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/dashboard", dashboardRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/api/calls", callRoutes);

/* =========================
   ERROR HANDLING
========================= */

app.use(notFound);
app.use(errorHandler);

/* =========================
   SERVER + SOCKET.IO
========================= */

const PORT = process.env.PORT || 5000;

const httpServer =
  http.createServer(app);

const io = new Server(
  httpServer,
  {
    cors: {
      origin: true,
      credentials: true,
    },
  }
);

/*
 * Controller ko Socket.IO access
 */
app.set("io", io);

/*
 * Socket authentication
 */
io.use(async (socket, next) => {
  try {
    const token =
      socket.handshake.auth?.token;

    if (!token) {
      return next(
        new Error(
          "Authentication required"
        )
      );
    }

    const decoded =
      jwt.verify(
        token,
        process.env.JWT_SECRET
      );

    const user =
      await User.findById(
        decoded.id
      ).select("-password");

    if (!user) {
      return next(
        new Error(
          "User not found"
        )
      );
    }

    if (!user.isActive) {
      return next(
        new Error(
          "User is inactive"
        )
      );
    }

    socket.user = user;

    next();
  } catch (error) {
    next(
      new Error(
        "Socket authentication failed"
      )
    );
  }
});

io.on("connection", (socket) => {
  const userId =
    String(socket.user._id);

  console.log(
    "[Socket.IO] Client connected:",
    socket.id,
    "User:",
    userId
  );

  /*
   * User-specific room
   */
  socket.join(
    `user:${userId}`
  );

  /*
   * Role-specific room
   */
  socket.join(
    `role:${socket.user.role}`
  );

  socket.emit(
    "whatsapp:socket-ready",
    {
      userId,
    }
  );

  socket.on(
    "disconnect",
    () => {
      console.log(
        "[Socket.IO] Client disconnected:",
        socket.id,
        "User:",
        userId
      );
    }
  );
});

/* =========================
   DATABASE + SERVER
========================= */

connectDB()
  .then(() => {
    console.log(
      "[MongoDB] Database connection established"
    );

    httpServer.listen(
      PORT,
      () => {
        console.log(
          `[HYCO CRM] Server running on port ${PORT}`
        );
      }
    );
  })
  .catch((error) => {
    console.error(
      "[Server] Startup failed:",
      error
    );

    process.exit(1);
  });