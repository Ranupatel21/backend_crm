import express from "express";

import {
  connectWhatsApp,
  whatsappStatus,
  disconnectWhatsAppAccount,
  getConversations,
  getMessages,
  sendMessage,
  assignConversation,
  openLeadConversation
} from "../controllers/whatsappController.js";

import { protect } from "../middleware/auth.js";

const router = express.Router();

router.use(protect);

/*
|--------------------------------------------------------------------------
| WhatsApp Account
|--------------------------------------------------------------------------
*/

router.post(
  "/connect",
  connectWhatsApp
);

router.get(
  "/status",
  whatsappStatus
);

router.post(
  "/disconnect",
  disconnectWhatsAppAccount
);

/*
|--------------------------------------------------------------------------
| Conversations
|--------------------------------------------------------------------------
*/

router.get(
  "/conversations",
  getConversations
);

router.get(
  "/conversations/:id/messages",
  getMessages
);

router.post(
  "/conversations/:id/messages",
  sendMessage
);
router.post(
  "/leads/:leadId/conversation",
  openLeadConversation
);
router.patch(
  "/conversations/:id/assign",
  assignConversation
);


export default router;