import pkg from "whatsapp-web.js";
import QRCode from "qrcode";

import WhatsAppConversation from "../models/WhatsAppConversation.js";
import WhatsAppMessage from "../models/WhatsAppMessage.js";
import Lead from "../models/Lead.js";
import LeadActivity from "../models/LeadActivity.js";
import Notification from "../models/Notification.js";
import User from "../models/User.js";

const { Client, LocalAuth } = pkg;

/*
|--------------------------------------------------------------------------
| WhatsApp Clients
|--------------------------------------------------------------------------
|
| userId => WhatsApp Client
|
*/
const whatsappClients = new Map();

/*
|--------------------------------------------------------------------------
| WhatsApp States
|--------------------------------------------------------------------------
|
| userId => {
|   status: "disconnected" | "connecting" | "qr" | "connected",
|   qr: string | null
| }
|
*/
const whatsappStates = new Map();

let ioInstance = null;

/*
|--------------------------------------------------------------------------
| Helpers
|--------------------------------------------------------------------------
*/

const getUserKey = (userId) => String(userId);

const getState = (userId) => {
  const key = getUserKey(userId);

  if (!whatsappStates.has(key)) {
    whatsappStates.set(key, {
      status: "disconnected",
      qr: null,
    });
  }

  return whatsappStates.get(key);
};

const emitToUser = (userId, event, data) => {
  if (!ioInstance) return;

  ioInstance.to(`user:${userId}`).emit(event, data);
};

const normalizeWhatsAppId = (phone) => {
  let number = String(phone).replace(/\D/g, "");

  // Indian 10-digit number
  if (number.length === 10) {
    number = `91${number}`;
  }

  // Already Indian country code
  if (number.startsWith("91") && number.length === 12) {
    return `${number}@c.us`;
  }

  throw new Error(`Invalid WhatsApp number: ${phone}`);
};

const normalizePhone = (phone) => {
  return String(phone).replace(/\D/g, "");
};
const getWhatsAppMessageId = (message) =>
  message?.id?.$1 ||
  message?.id?._serialized ||
  message?.id?.id ||
  null;



const findLeadByPhone = async (phone) => {
  const normalizedPhone = normalizePhone(phone);

  if (!normalizedPhone) {
    return null;
  }

  const last10Digits = normalizedPhone.slice(-10);

  return Lead.findOne({
    $or: [
      { phone: normalizedPhone },
      { phone: last10Digits },
      { phone: `+${normalizedPhone}` },
      { phoneNormalized: normalizedPhone },
      { phoneNormalized: last10Digits },
      { phoneNormalized: `+${normalizedPhone}` },
    ],
  });
};



const getPhoneDigits = (value) =>
  String(value || "").replace(/\D/g, "");

const isSamePhone = (first, second) => {
  const a = getPhoneDigits(first);
  const b = getPhoneDigits(second);

  if (!a || !b) return false;

  return a === b || a.slice(-10) === b.slice(-10);
};

const isSavedWhatsAppContact = async (
  client,
  contact,
  phone,
  messageFrom
) => {
  // Direct contact information
  if (contact?.isMyContact === true) {
    return true;
  }

  try {
    // Resolve the real phone contact for newer @lid IDs
    if (messageFrom?.endsWith("@lid")) {
      const mappings = await client.getContactLidAndPhone([
        messageFrom,
      ]);

      const mapping = mappings?.find(
        (item) => item.lid === messageFrom
      );

      if (mapping?.pn?.endsWith("@c.us")) {
        const mappedPhone = mapping.pn.replace("@c.us", "");

        if (isSamePhone(mappedPhone, phone)) {
          // Keep searching the contact list to verify saved status.
          console.log(
            "[WhatsApp] LID mapped to phone:",
            mappedPhone
          );
        }
      }
    }

    const contacts = await client.getContacts();

    const matchedContact = contacts.find((item) => {
      const contactId = item?.id?._serialized || "";
      const contactNumber = item?.number || "";

      return (
        contactId === messageFrom ||
        isSamePhone(contactNumber, phone) ||
        (
          contactId.endsWith("@c.us") &&
          isSamePhone(
            contactId.replace("@c.us", ""),
            phone
          )
        )
      );
    });

    return matchedContact?.isMyContact === true;
  } catch (error) {
    console.error(
      "[WhatsApp] Saved contact check failed:",
      error.message
    );

    // Fail safe: don't automatically create a lead
    // when saved-contact status cannot be verified.
    return true;
  }
};

/*
|--------------------------------------------------------------------------
| Incoming Message Handler
|--------------------------------------------------------------------------
*/

const handleIncomingMessage = async (clientUserId, message, client) => {
  try {
    /*
     * CRM WhatsApp account ke khud ke messages ignore
     */
    if (message.fromMe) return;

    /*
     * WhatsApp Status ignore
     *
     * Status messages generally use:
     * status@broadcast
     */
    if (
      message.from === "status@broadcast" ||
      message.to === "status@broadcast"
    ) {
      console.log(
        "[WhatsApp] Status message ignored:",
        message.from
      );
      return;
    }

    /*
     * Groups ignore
     */
    if (
      message.from?.endsWith("@g.us") ||
      message.to?.endsWith("@g.us")
    ) {
      console.log(
        "[WhatsApp] Group message ignored:",
        message.from
      );
      return;
    }

    /*
     * Channels / Newsletters ignore
     */
    if (
      message.from?.endsWith("@newsletter") ||
      message.to?.endsWith("@newsletter")
    ) {
      console.log(
        "[WhatsApp] Channel/Newsletter message ignored:",
        message.from
      );
      return;
    }

    /*
     * Sirf normal WhatsApp individual chats process karo.
     *
     * @c.us = normal WhatsApp user
     * @lid   = newer WhatsApp privacy/ID format
     *
     * Baaki unknown chat types ignore.
     */
    const fromId = message.from || "";

    if (
      !fromId.endsWith("@c.us") &&
      !fromId.endsWith("@lid")
    ) {
      console.log(
        "[WhatsApp] Unsupported chat type ignored:",
        fromId
      );
      return;
    }

    const body = message.body?.trim();

    if (!body) return;

    console.log("[WhatsApp] Incoming message:", {
      userId: clientUserId,
      from: message.from,
      body,
    });

    /*
     * @lid handling
     */
    let contact;

    try {
      contact = await message.getContact();
    } catch (error) {
      console.error(
        "[WhatsApp] Failed to get contact:",
        error.message
      );

      return;
    }

    console.log("[WhatsApp] Contact details:", {
      from: message.from,
      number: contact?.number,
      id: contact?.id?._serialized,
      name: contact?.name,
      pushname: contact?.pushname,
    });

    /*
     * @lid ke case me actual @c.us ID use karo
     */
    const contactId = contact?.id?._serialized;

    let phone = contact?.number;

    if (contactId?.endsWith("@c.us")) {
      phone = contactId.replace("@c.us", "");
    }

    if (!phone) {
      console.error(
        "[WhatsApp] Could not resolve contact phone:",
        message.from
      );

      return;
    }

  
const normalizedPhone = normalizePhone(phone);

const contactName =
  contact?.name?.trim() ||
  contact?.shortName?.trim() ||
  contact?.pushname?.trim() ||
  "";

console.log("[WhatsApp] Contact name:", contactName);

console.log(
  "[WhatsApp] Resolved phone:",
  normalizedPhone
);

    /*
     * Existing lead
     */
    // const lead = await findLeadByPhone(normalizedPhone);

// Check whether the phone already belongs to a CRM lead
let lead = await findLeadByPhone(normalizedPhone);

// Verify whether this is a saved WhatsApp contact
const isSavedContact = await isSavedWhatsAppContact(
  client,
  contact,
  normalizedPhone,
  message.from
);

if (isSavedContact) {
  console.log(
    "[WhatsApp] Saved contact detected; skipping lead creation:",
    normalizedPhone
  );
} else if (!lead) {
  lead = await Lead.create({
    phone: normalizedPhone,
    phoneNormalized: normalizedPhone,
    leadSource: "WhatsApp",
    assignedTo: clientUserId,
    status: "New",
    createdBy: clientUserId,
  });

  console.log(
    "[WhatsApp] New unsaved contact lead created:",
    lead._id,
    "Phone:",
    normalizedPhone
  );
}


    /*
     * IMPORTANT:
     * Conversation is identified by:
     *
     * whatsappUser + phone
     *
     * Not only phone.
     */
   const incomingDigits = normalizePhone(normalizedPhone);
const incomingLast10 = incomingDigits.slice(-10);

let conversation = await WhatsAppConversation.findOne({
  whatsappUser: clientUserId,
  phone: {
    $in: [
      incomingDigits,
      incomingLast10,
      `91${incomingLast10}`,
      `+91${incomingLast10}`,
    ],
  },
});
    /*
     * User information
     */
    const whatsappUser = await User.findById(clientUserId).select(
      "_id name role isActive"
    );

    if (!whatsappUser || !whatsappUser.isActive) {
      console.error(
        "[WhatsApp] User not found/inactive:",
        clientUserId
      );

      return;
    }

    /*
     * Existing lead assigned hai to wahi assignment rakho.
     * Otherwise WhatsApp owner ko assign karo.
     */
    const assignedTo =
      lead?.assignedTo ||
      clientUserId;

    /*
     * Conversation create
     */
    
    if (!conversation) {
      conversation = await WhatsAppConversation.create({
        whatsappUser: clientUserId,
        phone: normalizedPhone,
        lead: lead?._id || null,
        assignedTo,
        lastMessageAt: new Date(),
        lastMessagePreview: body.slice(0, 120),
        contactName: contactName,
      });

      console.log(
        "[WhatsApp] New conversation created:",
        conversation._id
      );
    } else {
      conversation.lastMessageAt = new Date();
      conversation.lastMessagePreview =
        body.slice(0, 120);

      if (!conversation.lead && lead) {
        conversation.lead = lead._id;
      }

      if (!conversation.assignedTo) {
        conversation.assignedTo =
          lead?.assignedTo ||
          clientUserId;
      }
if (contactName) {
  conversation.contactName = contactName;
}
      await conversation.save();

      console.log(
        "[WhatsApp] Conversation updated:",
        conversation._id
      );
    }

    /*
     * Save incoming message
     */
//     const existingMessage = await WhatsAppMessage.findOne({
//   conversation: conversation._id,
//   direction: "out",
//   body,
//   sentBy: userKey,
//   whatsappMessageId: null,
//   timestamp: {
//     $gte: new Date(Date.now() - 15_000),
//   },
// }).sort({ createdAt: -1 });

// if (existingMessage) {
//   existingMessage.whatsappMessageId = whatsappMessageId;
//   await existingMessage.save();

//   console.log(
//     "[WhatsApp] Existing outgoing message linked:",
//     existingMessage._id
//   );

//   return;
// }

    const savedMessage =
      await WhatsAppMessage.create({
        conversation: conversation._id,
        direction: "in",
        body,
        timestamp: new Date(),
      });

    console.log(
      "[WhatsApp] Incoming message saved:",
      savedMessage._id
    );

    /*
     * Lead activity
     */
    if (conversation.lead) {
      await LeadActivity.create({
        lead: conversation.lead,
        user: clientUserId,
        type: "WhatsApp Message",
        description: body.slice(0, 200),
      });
    }

    /*
     * Notification
     */
    // const recipient =
    //   conversation.assignedTo ||
    //   clientUserId;
   const recipient = clientUserId;
    if (recipient) {
      await Notification.create({
        recipient,
        type: "whatsapp",
        title: "WhatsApp",
        message: `New WhatsApp message from ${
          lead?.name || normalizedPhone
        }`,
        lead: conversation.lead || null,
      });
    }

    /*
     * Real-time event
     *
     * Owner gets it.
     * Manager/Super Admin also get it.
     */
    const eventData = {
      conversationId:
        conversation._id.toString(),
      whatsappUser:
        clientUserId.toString(),
      message: savedMessage,
    };

    emitToUser(
      clientUserId,
      "whatsapp:message",
      eventData
    );

    /*
     * Manager + Super Admin rooms
     */
    if (ioInstance) {
      ioInstance
        .to("role:manager")
        .to("role:super_admin")
        .emit(
          "whatsapp:message",
          eventData
        );
    }
  } catch (error) {
    console.error(
      "[WhatsApp] Incoming message processing failed:",
      error
    );
  }
};

/*
|--------------------------------------------------------------------------
| Initialize One User's WhatsApp
|--------------------------------------------------------------------------
*/

export const initWhatsAppForUser = async (
  io,
  userId
) => {
  ioInstance = io;

  const userKey = getUserKey(userId);

  /*
   * Already running
   */
  if (whatsappClients.has(userKey)) {
    return whatsappClients.get(userKey);
  }

  const state = getState(userKey);

  state.status = "connecting";
  state.qr = null;

  emitToUser(userKey, "whatsapp:status", {
    status: "connecting",
  });

  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: `hyco-user-${userKey}`,
    }),

    puppeteer: {
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
      ],
    },
  });

  whatsappClients.set(userKey, client);

  /*
   * QR
   */
  client.on("qr", async (qr) => {
    try {
      console.log(
        `[WhatsApp] QR generated for user ${userKey}`
      );

      state.status = "qr";

      /*
       * QR ko data URL me convert karo
       * frontend directly <img> me show kar sakta hai.
       */
      state.qr = await QRCode.toDataURL(qr);

      emitToUser(userKey, "whatsapp:qr", {
        qr: state.qr,
      });

      emitToUser(userKey, "whatsapp:status", {
        status: "qr",
      });
    } catch (error) {
      console.error(
        "[WhatsApp] QR generation failed:",
        error.message
      );
    }
  });

  /*
   * Authenticated
   */
  client.on("authenticated", () => {
    console.log(
      `[WhatsApp] User ${userKey} authenticated`
    );

    state.status = "connecting";
    state.qr = null;

    emitToUser(userKey, "whatsapp:status", {
      status: "authenticated",
    });
  });

  /*
   * Ready
   */
  client.on("ready", () => {
    console.log(
      `[WhatsApp] User ${userKey} WhatsApp is ready`
    );

    state.status = "connected";
    state.qr = null;

    emitToUser(userKey, "whatsapp:status", {
      status: "connected",
    });
  });

  /*
   * Auth failure
   */
  client.on("auth_failure", (message) => {
    console.error(
      `[WhatsApp] User ${userKey} authentication failed:`,
      message
    );

    state.status = "disconnected";
    state.qr = null;

    emitToUser(userKey, "whatsapp:status", {
      status: "disconnected",
      error: "Authentication failed",
    });
  });

  /*
   * Disconnected
   */
  client.on("disconnected", (reason) => {
    console.log(
      `[WhatsApp] User ${userKey} disconnected:`,
      reason
    );

    state.status = "disconnected";
    state.qr = null;

    whatsappClients.delete(userKey);

    emitToUser(userKey, "whatsapp:status", {
      status: "disconnected",
      reason,
    });
  });

  /*
   * Incoming message
   */
  client.on("message", async (message) => {
    await handleIncomingMessage(
      userKey,
      message,
       client
    );
  });


client.on("message_create", async (message) => {
  if (!message.fromMe) return;

  try {
    const whatsappMessageId = getWhatsAppMessageId(message);
    const body = message.body?.trim();
    const recipientId = message.to || message.id?.remote || "";

    if (!whatsappMessageId || !body || !recipientId) return;

    if (
      recipientId === "status@broadcast" ||
      recipientId.endsWith("@g.us") ||
      recipientId.endsWith("@newsletter")
    ) {
      return;
    }

    // Give the CRM controller time to save messages sent from CRM.
    await new Promise((resolve) => setTimeout(resolve, 1200));

const alreadySaved = await WhatsAppMessage.findOne({
  whatsappMessageId,
});

if (alreadySaved) {
  return;
}

// Controller ne message save kiya ho,
// to wahi record WhatsApp ID se link karo.
const recentMessage = await WhatsAppMessage.findOne({
  direction: "out",
  conversation: {
    $in: await WhatsAppConversation.find({
      whatsappUser: userKey,
    }).distinct("_id"),
  },
  sentBy: userKey,
  body,
  whatsappMessageId: null,
  createdAt: {
    $gte: new Date(Date.now() - 15_000),
  },
}).sort({ createdAt: -1 });

if (recentMessage) {
  recentMessage.whatsappMessageId = whatsappMessageId;
  await recentMessage.save();

  console.log(
    "[WhatsApp] Linked existing outgoing message:",
    recentMessage._id
  );

  return;
}

    // Resolve @lid to the real WhatsApp phone number.
    let phone = "";

    if (recipientId.endsWith("@lid")) {
      try {
        const mappings = await client.getContactLidAndPhone([
          recipientId,
        ]);

        const mapping = mappings?.find(
          (item) => item.lid === recipientId
        );

        if (mapping?.pn?.endsWith("@c.us")) {
          phone = mapping.pn.replace("@c.us", "");
        }
      } catch (error) {
        console.error(
          "[WhatsApp] LID mapping failed:",
          error.message
        );
      }
    } else if (recipientId.endsWith("@c.us")) {
      phone = recipientId.replace("@c.us", "");
    }

    // Fallback for regular contact IDs.
    if (!phone) {
      try {
        const contact = await client.getContactById(recipientId);

        if (contact?.id?._serialized?.endsWith("@c.us")) {
          phone = contact.id._serialized.replace("@c.us", "");
        } else if (contact?.number) {
          phone = contact.number;
        }
      } catch (error) {
        console.error(
          "[WhatsApp] Contact lookup failed:",
          error.message
        );
      }
    }

    if (!phone) {
      console.error(
        "[WhatsApp] Could not resolve recipient phone:",
        recipientId
      );
      return;
    }

    // Store Indian numbers consistently as 91 + 10 digits.
    let phoneDigits = normalizePhone(phone);

    if (phoneDigits.length === 10) {
      phoneDigits = `91${phoneDigits}`;
    }

    if (
      phoneDigits.length !== 12 ||
      !phoneDigits.startsWith("91")
    ) {
      console.error(
        "[WhatsApp] Invalid recipient number:",
        phoneDigits
      );
      return;
    }

    const last10 = phoneDigits.slice(-10);

    const lead = await findLeadByPhone(phoneDigits);

    // IMPORTANT: search first; create only if no matching conversation exists.
    let conversation = await WhatsAppConversation.findOne({
      whatsappUser: userKey,
      phone: {
        $in: [
          phoneDigits,
          last10,
          `+${phoneDigits}`,
        ],
      },
    });

    // Never create a new conversation from an unresolved LID.
    if (!conversation && recipientId.endsWith("@lid")) {
      console.error(
        "[WhatsApp] No existing conversation found for resolved LID:",
        recipientId,
        phoneDigits
      );
      return;
    }

    if (!conversation) {
      conversation = await WhatsAppConversation.create({
        whatsappUser: userKey,
        phone: phoneDigits,
        lead: lead?._id || null,
        assignedTo: lead?.assignedTo || userKey,
        lastMessageAt: new Date(),
        lastMessagePreview: body.slice(0, 120),
      });

      console.log(
        "[WhatsApp] New conversation created:",
        conversation._id
      );
    } else {
      conversation.lastMessageAt = new Date();
      conversation.lastMessagePreview = body.slice(0, 120);

      if (!conversation.lead && lead) {
        conversation.lead = lead._id;
      }

      if (!conversation.assignedTo) {
        conversation.assignedTo = lead?.assignedTo || userKey;
      }

      await conversation.save();

      console.log(
        "[WhatsApp] Existing conversation reused:",
        conversation._id
      );
    }

    const savedMessage = await WhatsAppMessage.create({
      conversation: conversation._id,
      direction: "out",
      body,
      sentBy: userKey,
      whatsappMessageId,
      timestamp: new Date(),
    });

    if (conversation.lead) {
      await LeadActivity.create({
        lead: conversation.lead,
        user: userKey,
        type: "WhatsApp Message",
        description: body.slice(0, 200),
      });
    }

    const eventData = {
      conversationId: conversation._id.toString(),
      whatsappUser: userKey,
      message: savedMessage,
    };

    emitToUser(userKey, "whatsapp:message", eventData);

    if (ioInstance) {
      ioInstance
        .to("role:manager")
        .to("role:super_admin")
        .emit("whatsapp:message", eventData);
    }

    console.log(
      "[WhatsApp] Phone message saved:",
      savedMessage._id,
      "Conversation:",
      conversation._id
    );
  } catch (error) {
    console.error(
      "[WhatsApp] Outgoing message processing failed:",
      error
    );
  }
});


  /*
   * Initialize
   */
  await client.initialize();

  return client;
};

/*
|--------------------------------------------------------------------------
| Send Message Through Specific User's WhatsApp
|--------------------------------------------------------------------------
*/

export const sendWhatsAppMessage = async (
  userId,
  phone,
  message
) => {
  const userKey = getUserKey(userId);

  const client = whatsappClients.get(userKey);

  if (!client) {
    throw new Error(
      "Your WhatsApp Web is not connected"
    );
  }

  const state = getState(userKey);

  if (state.status !== "connected") {
    throw new Error(
      "Your WhatsApp Web is not ready"
    );
  }

  const chatId = normalizeWhatsAppId(phone);

  console.log(
    `[WhatsApp] User ${userKey} sending to:`,
    chatId
  );

  const sentMessage = await client.sendMessage(
    chatId,
    message
  );

  return sentMessage;
};

/*
|--------------------------------------------------------------------------
| Status
|--------------------------------------------------------------------------
*/

export const getWhatsAppStatus = (userId) => {
  const state = getState(userId);

  return {
    connected:
      state.status === "connected",

    status: state.status,

    qr: state.qr,
  };
};

/*
|--------------------------------------------------------------------------
| Disconnect / Logout
|--------------------------------------------------------------------------
*/

export const disconnectWhatsApp = async (
  userId
) => {
  const userKey = getUserKey(userId);

  const client = whatsappClients.get(userKey);

  if (!client) {
    const state = getState(userKey);

    state.status = "disconnected";
    state.qr = null;

    return;
  }

  try {
    await client.logout();
  } catch (error) {
    console.error(
      `[WhatsApp] Logout failed for ${userKey}:`,
      error.message
    );
  }

  try {
    await client.destroy();
  } catch (error) {
    console.error(
      `[WhatsApp] Destroy failed for ${userKey}:`,
      error.message
    );
  }

  whatsappClients.delete(userKey);

  const state = getState(userKey);

  state.status = "disconnected";
  state.qr = null;

  emitToUser(userKey, "whatsapp:status", {
    status: "disconnected",
  });
};

/*
|--------------------------------------------------------------------------
| Get Connected Client
|--------------------------------------------------------------------------
*/

export const getWhatsAppClient = (userId) => {
  return whatsappClients.get(
    getUserKey(userId)
  );
};
export const restoreWhatsAppSessions = async (io) => {
  ioInstance = io;

  try {
    const users = await User.find({
      isActive: true,
    }).select("_id");

    console.log(
      `[WhatsApp] Restoring sessions for ${users.length} active users...`
    );

    for (const user of users) {
      try {
        await initWhatsAppForUser(
          io,
          user._id
        );

        console.log(
          `[WhatsApp] Session restore started for user ${user._id}`
        );
      } catch (error) {
        console.error(
          `[WhatsApp] Failed to restore session for user ${user._id}:`,
          error.message
        );
      }
    }
  } catch (error) {
    console.error(
      "[WhatsApp] Session restoration failed:",
      error
    );
  }
};
export { normalizeWhatsAppId };