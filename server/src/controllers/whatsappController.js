import WhatsAppConversation from "../models/WhatsAppConversation.js";
import WhatsAppMessage from "../models/WhatsAppMessage.js";
import LeadActivity from "../models/LeadActivity.js";
import Lead from "../models/Lead.js";
import {
  sendWhatsAppMessage,
  initWhatsAppForUser,
  getWhatsAppStatus,
  disconnectWhatsApp,
} from "../services/whatsapp.service.js";

import { asyncHandler } from "../middleware/asyncHandler.js";

/*
|--------------------------------------------------------------------------
| Connect WhatsApp
|--------------------------------------------------------------------------
| POST /api/whatsapp/connect
*/
export const connectWhatsApp = asyncHandler(
  async (req, res) => {
    await initWhatsAppForUser(
      req.app.get("io"),
      req.user._id
    );

    const status = getWhatsAppStatus(
      req.user._id
    );

    res.json({
      success: true,
      ...status,
    });
  }
);

/*
|--------------------------------------------------------------------------
| WhatsApp Status
|--------------------------------------------------------------------------
| GET /api/whatsapp/status
*/
export const whatsappStatus = asyncHandler(
  async (req, res) => {
    res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");

    const status = getWhatsAppStatus(
      req.user._id
    );

    res.json({
      success: true,
      ...status,
    });
  }
);

/*
|--------------------------------------------------------------------------
| Disconnect WhatsApp
|--------------------------------------------------------------------------
| POST /api/whatsapp/disconnect
*/
export const disconnectWhatsAppAccount =
  asyncHandler(async (req, res) => {
    await disconnectWhatsApp(
      req.user._id
    );

    res.json({
      success: true,
      message: "WhatsApp disconnected successfully",
    });
  });

/*
|--------------------------------------------------------------------------
| List Conversations
|--------------------------------------------------------------------------
| GET /api/whatsapp/conversations
*/
export const getConversations = asyncHandler(
  async (req, res) => {
    const filter = {};

    /*
     * Sales employee:
     * only assigned conversations
     */
    if (req.user.role === "sales_employee") {
      filter.whatsappUser  = req.user._id;
    }

    /*
     * Manager / Super Admin:
     * all conversations
     */

    const conversations =
      await WhatsAppConversation.find(filter)
        .populate(
          "lead",
          "name phone status"
        )
        .populate(
          "assignedTo",
          "name email role"
        )
        .populate(
          "whatsappUser",
          "name email role"
        )
        .sort({
          lastMessageAt: -1,
        });

    res.json({
      success: true,
      conversations,
    });
  }
);

/*
|--------------------------------------------------------------------------
| Get Messages
|--------------------------------------------------------------------------
| GET /api/whatsapp/conversations/:id/messages
|--------------------------------------------------------------------------
*/
export const getMessages = asyncHandler(
  async (req, res) => {
    const conversation =
      await WhatsAppConversation.findById(
        req.params.id
      )
        .populate(
          "lead",
          "name phone status"
        )
        .populate(
          "assignedTo",
          "name email role"
        )
        .populate(
          "whatsappUser",
          "name email role"
        );

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    /*
     * Sales employee can only access
     * conversations assigned to them.
     */
    // if (
    //   req.user.role === "sales_employee" &&
    //   String(conversation.assignedTo?._id) !==
    //     String(req.user._id)
    // ) {
    //   return res.status(403).json({
    //     success: false,
    //     message: "Access denied",
    //   });
    // }
   if (
  req.user.role === "sales_employee" &&
  String(conversation.whatsappUser?._id) !==
    String(req.user._id)
) {
  return res.status(403).json({
    success: false,
    message: "Access denied",
  });
}
    const messages =
      await WhatsAppMessage.find({
        conversation: conversation._id,
      }).sort({
        timestamp: 1,
      });

    res.json({
      success: true,
      conversation,
      messages,
    });
  }
);

/*
|--------------------------------------------------------------------------
| Send Message
|--------------------------------------------------------------------------
| POST /api/whatsapp/conversations/:id/messages
|--------------------------------------------------------------------------
*/

export const sendMessage = asyncHandler(
  async (req, res) => {
    const { body } = req.body;

    if (!body || !body.trim()) {
      return res.status(400).json({
        success: false,
        message: "Message body is required",
      });
    }

    const conversation =
      await WhatsAppConversation.findById(req.params.id);

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    // Sales employee access check
    if (
      req.user.role === "sales_employee" &&
      String(conversation.assignedTo) !== String(req.user._id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // WhatsApp account ownership check
    if (
      String(conversation.whatsappUser) !== String(req.user._id)
    ) {
      return res.status(403).json({
        success: false,
        message:
          "This conversation belongs to another WhatsApp account",
      });
    }

    let sentWhatsAppMessage;

    try {
      sentWhatsAppMessage = await sendWhatsAppMessage(
        req.user._id,
        conversation.phone,
        body.trim()
      );
    } catch (error) {
      console.error(
        "[WhatsApp] Send failed:",
        error.message
      );

      return res.status(503).json({
        success: false,
        message: "WhatsApp message could not be sent",
        error: error.message,
      });
    }

    // Declare outside try so it is available below
    const whatsappMessageId =
      sentWhatsAppMessage?.id?.$1 ||
      sentWhatsAppMessage?.id?._serialized ||
      sentWhatsAppMessage?.id?.id ||
      null;

    // Save message after WhatsApp accepts it
    const message = await WhatsAppMessage.create({
      conversation: conversation._id,
      direction: "out",
      body: body.trim(),
      sentBy: req.user._id,
      whatsappMessageId,
      timestamp: new Date(),
    });

    conversation.lastMessageAt = new Date();
    conversation.lastMessagePreview = body.trim().slice(0, 120);

    await conversation.save();

    if (conversation.lead) {
      await LeadActivity.create({
        lead: conversation.lead,
        user: req.user._id,
        type: "WhatsApp Message",
        description: body.trim().slice(0, 200),
      });
    }

    return res.status(201).json({
      success: true,
      message,
    });
  }
);

/*
|--------------------------------------------------------------------------
| Assign Conversation
|--------------------------------------------------------------------------
| PATCH /api/whatsapp/conversations/:id/assign
|--------------------------------------------------------------------------
*/
export const assignConversation =
  asyncHandler(async (req, res) => {
    if (
      req.user.role ===
      "sales_employee"
    ) {
      return res.status(403).json({
        success: false,
        message:
          "You are not permitted to assign conversations",
      });
    }

    const { assignedTo } = req.body;

    const conversation =
      await WhatsAppConversation.findById(
        req.params.id
      );

    if (!conversation) {
      return res.status(404).json({
        success: false,
        message: "Conversation not found",
      });
    }

    conversation.assignedTo =
      assignedTo || null;

    await conversation.save();

    const updatedConversation =
      await WhatsAppConversation.findById(
        conversation._id
      )
        .populate(
          "lead",
          "name phone status"
        )
        .populate(
          "assignedTo",
          "name email role"
        )
        .populate(
          "whatsappUser",
          "name email role"
        );

    res.json({
      success: true,
      conversation: updatedConversation,
    });
  });
  /*
|--------------------------------------------------------------------------
| Get / Create Conversation From Lead
|--------------------------------------------------------------------------
| POST /api/whatsapp/leads/:leadId/conversation
*/
export const openLeadConversation = asyncHandler(
  async (req, res) => {
    const { leadId } = req.params;

    const lead = await Lead.findById(leadId);

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: "Lead not found",
      });
    }

    /*
     * Sales employee can only open
     * their own assigned lead.
     */
    if (
      req.user.role === "sales_employee" &&
      String(lead.assignedTo) !== String(req.user._id)
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    /*
     * Phone is required to start
     * a WhatsApp conversation.
     */
    if (!lead.phone) {
      return res.status(400).json({
        success: false,
        message: "Lead does not have a phone number",
      });
    }

    /*
     * Current user's WhatsApp must
     * already be connected.
     */
    const whatsappStatus = getWhatsAppStatus(
      req.user._id
    );

    if (!whatsappStatus.connected) {
      return res.status(409).json({
        success: false,
        code: "WHATSAPP_NOT_CONNECTED",
        message:
          "Please connect your WhatsApp first",
      });
    }

    const normalizedPhone = String(
      lead.phone
    ).replace(/\D/g, "");

    /*
     * Conversation belongs to the
     * current user's WhatsApp account.
     */
    let conversation =
      await WhatsAppConversation.findOne({
        whatsappUser: req.user._id,
        phone: normalizedPhone,
      });

    /*
     * Existing conversation
     */
    if (conversation) {
      if (!conversation.lead) {
        conversation.lead = lead._id;
        await conversation.save();
      }

      const populatedConversation =
        await WhatsAppConversation.findById(
          conversation._id
        )
          .populate(
            "lead",
            "name phone status"
          )
          .populate(
            "assignedTo",
            "name email role"
          )
          .populate(
            "whatsappUser",
            "name email role"
          );

      return res.json({
        success: true,
        existing: true,
        conversation: populatedConversation,
      });
    }

    /*
     * New conversation
     */
    conversation =
      await WhatsAppConversation.create({
        whatsappUser: req.user._id,
        lead: lead._id,
        phone: normalizedPhone,
        assignedTo:
          lead.assignedTo || req.user._id,
        lastMessageAt: new Date(),
        lastMessagePreview: "",
      });

    const populatedConversation =
      await WhatsAppConversation.findById(
        conversation._id
      )
        .populate(
          "lead",
          "name phone status"
        )
        .populate(
          "assignedTo",
          "name email role"
        )
        .populate(
          "whatsappUser",
          "name email role"
        );

    res.status(201).json({
      success: true,
      existing: false,
      conversation: populatedConversation,
    });
  }
);