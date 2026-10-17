const whatsappDb = require('../services/whatsappDbService');
const whatsappGraph = require('../services/whatsappGraphService');
const documentPrintLayoutService = require('../services/documentPrintLayoutService');
const sapService = require('../services/sapService');
const { getOrCreateOpenConversation, insertMessage, upsertCustomer } = require('./whatsappWebhookController');

const assertWhatsAppCompany = (req) => {
  const configuredCompanyId = Number(process.env.WHATSAPP_COMPANY_ID);
  const requestCompanyId = Number(req.auth?.companyId);
  if (!Number.isInteger(configuredCompanyId) || configuredCompanyId <= 0) {
    const error = new Error('WhatsApp is not assigned to a company. Configure WHATSAPP_COMPANY_ID.');
    error.statusCode = 503;
    throw error;
  }
  if (requestCompanyId !== configuredCompanyId) {
    const error = new Error('WhatsApp sending is not configured for the active company.');
    error.statusCode = 403;
    throw error;
  }
};

const normalizePhoneNumber = (value) => {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.length === 10) return `91${digits}`;
  return digits;
};

const getCustomerPhoneFromBpMaster = async (cardCode) => {
  const normalizedCardCode = String(cardCode || '').trim();
  if (!normalizedCardCode) return '';

  try {
    const response = await sapService.request({
      method: 'GET',
      url: `${sapService.buildStringKeyPath('BusinessPartners', normalizedCardCode)}?$select=Cellular,Phone1,Phone2`,
    });
    const bp = response.data || {};
    return normalizePhoneNumber(bp.Cellular || bp.Phone1 || bp.Phone2 || '');
  } catch (error) {
    console.error('[WHATSAPP] Failed to load BP phone number for', normalizedCardCode, error.message);
    return '';
  }
};

const listConversations = async (req, res) => {
  const status = String(req.query?.status || '').trim();

  const rows = await whatsappDb.queryRows(
    `SELECT
      c.id,
      c.status,
      c.assigned_user_id,
      c.last_message_at,
      c.created_at,
      cu.id AS customer_id,
      cu.phone_number,
      cu.display_name,
      cu.card_code,
      (SELECT body FROM whatsapp_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message_body,
      (SELECT message_type FROM whatsapp_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message_type
    FROM whatsapp_conversations c
    INNER JOIN whatsapp_customers cu ON cu.id = c.customer_id
    WHERE (@status = '' OR c.status = @status)
    ORDER BY COALESCE(c.last_message_at, c.created_at) DESC`,
    { status },
  );

  res.json(rows);
};

const getMessages = async (req, res) => {
  const conversationId = Number(req.params.id);
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ message: 'Invalid conversation id.' });
  }

  const rows = await whatsappDb.queryRows(
    `SELECT * FROM whatsapp_messages WHERE conversation_id = @conversation_id ORDER BY id ASC`,
    { conversation_id: conversationId },
  );

  res.json(rows);
};

const sendReply = async (req, res) => {
  try {
    assertWhatsAppCompany(req);
    const conversationId = Number(req.params.id);
    const body = String(req.body?.body || '').trim();
    if (!Number.isInteger(conversationId) || conversationId <= 0) {
      return res.status(400).json({ message: 'Invalid conversation id.' });
    }
    if (!body) {
      return res.status(400).json({ message: 'Reply text is required.' });
    }

    const conversation = await whatsappDb.queryOne(
      `SELECT c.*, cu.phone_number FROM whatsapp_conversations c
       INNER JOIN whatsapp_customers cu ON cu.id = c.customer_id
       WHERE c.id = @id`,
      { id: conversationId },
    );
    if (!conversation) {
      return res.status(404).json({ message: 'Conversation not found.' });
    }

    await whatsappGraph.sendText(conversation.phone_number, body);

    await insertMessage({
      conversationId,
      direction: 'outbound',
      messageType: 'text',
      body,
      sentByUserId: req.auth?.userId || null,
      isBot: false,
    });

    return res.status(201).json({ success: true });
  } catch (error) {
    const message = error?.response?.data?.error?.message || error?.message || 'Failed to send reply.';
    return res.status(error?.statusCode || 500).json({ message });
  }
};

const updateConversationStatus = async (req, res) => {
  const conversationId = Number(req.params.id);
  const status = String(req.body?.status || '').trim();
  if (!Number.isInteger(conversationId) || conversationId <= 0) {
    return res.status(400).json({ message: 'Invalid conversation id.' });
  }
  if (!['open', 'pending', 'closed'].includes(status)) {
    return res.status(400).json({ message: 'status must be one of open, pending, closed.' });
  }

  const result = await whatsappDb.execute(
    `UPDATE whatsapp_conversations SET status = @status WHERE id = @id`,
    { id: conversationId, status },
  );
  if (!result.changes) {
    return res.status(404).json({ message: 'Conversation not found.' });
  }
  return res.json({ success: true });
};

const updateCustomerCardCode = async (req, res) => {
  const customerId = Number(req.params.id);
  const cardCode = String(req.body?.card_code || '').trim();
  if (!Number.isInteger(customerId) || customerId <= 0) {
    return res.status(400).json({ message: 'Invalid customer id.' });
  }

  const result = await whatsappDb.execute(
    `UPDATE whatsapp_customers SET card_code = @card_code, updated_at = CURRENT_TIMESTAMP WHERE id = @id`,
    { id: customerId, card_code: cardCode || null },
  );
  if (!result.changes) {
    return res.status(404).json({ message: 'Customer not found.' });
  }
  return res.json({ success: true, card_code: cardCode || null });
};

const buildDocumentFileName = (documentType, docNum, docEntry) => {
  const slug = String(documentType || 'document').replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`).replace(/^-/, '');
  return `${slug}-${docNum || docEntry}.pdf`;
};

const TEMPLATE_PLACEHOLDER_KEYS = ['documentLabel', 'docNum', 'docEntry', 'cardCode', 'cardName'];

const renderTemplate = (templateBody, values = {}) =>
  String(templateBody || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key) =>
    (values[key] !== undefined && values[key] !== null ? String(values[key]) : match));

const getMessageTemplate = (documentType) =>
  whatsappDb.queryOne(
    `SELECT * FROM whatsapp_message_templates WHERE document_type = @document_type AND is_active = 1`,
    { document_type: documentType },
  );

const listDocumentTypes = (_req, res) => {
  res.json(documentPrintLayoutService.listDocumentTypes());
};

const listMessageTemplates = async (_req, res) => {
  const rows = await whatsappDb.queryRows(`SELECT * FROM whatsapp_message_templates ORDER BY document_type ASC`);
  res.json(rows);
};

const upsertMessageTemplate = async (req, res) => {
  const documentType = String(req.params.documentType || '').trim();
  const templateBody = String(req.body?.template_body || '').trim();
  if (!documentType) {
    return res.status(400).json({ message: 'documentType is required.' });
  }
  if (!templateBody) {
    return res.status(400).json({ message: 'template_body is required.' });
  }

  await whatsappDb.execute(
    `INSERT INTO whatsapp_message_templates (document_type, template_body, is_active)
     VALUES (@document_type, @template_body, 1)
     ON CONFLICT(document_type) DO UPDATE SET
       template_body = excluded.template_body,
       is_active = 1,
       updated_at = CURRENT_TIMESTAMP`,
    { document_type: documentType, template_body: templateBody },
  );

  return res.json(await getMessageTemplate(documentType));
};

const deleteMessageTemplate = async (req, res) => {
  const documentType = String(req.params.documentType || '').trim();
  const result = await whatsappDb.execute(
    `DELETE FROM whatsapp_message_templates WHERE document_type = @document_type`,
    { document_type: documentType },
  );
  if (!result.changes) {
    return res.status(404).json({ message: 'Template not found.' });
  }
  return res.json({ success: true });
};

// Generic "send this transaction's PDF over WhatsApp" — used by the Print Layout
// toolbar shared across every transaction screen (Sales Order, Delivery, AR Invoice, etc).
const sendDocumentPdf = async (req, res) => {
  try {
    assertWhatsAppCompany(req);
    const {
      documentType = 'arInvoice',
      docEntry,
      docNum,
      series,
      cardCode,
      docCode,
      schema,
      reportParameters,
      phoneNumber,
    } = req.body || {};

    if (!docEntry) {
      return res.status(400).json({ message: 'docEntry is required.' });
    }

    let to = normalizePhoneNumber(phoneNumber);
    if (!to && cardCode) {
      to = await getCustomerPhoneFromBpMaster(cardCode);
    }
    if (!to) {
      return res.status(400).json({
        message: cardCode
          ? `No phone number found on the Business Partner master for ${cardCode}. Add a Cellular/Phone number to that BP, or enter one manually.`
          : 'phoneNumber is required when no cardCode is provided.',
      });
    }

    const metadata = await documentPrintLayoutService.getDocumentReportMetadata({
      documentType,
      docEntry,
      docNum,
      series,
      cardCode,
      schema,
      docCode,
      auth: req.auth,
    });

    const printResult = await documentPrintLayoutService.printDocument({
      documentType,
      docEntry,
      docNum,
      series,
      cardCode,
      docCode,
      schema,
      reportParameters,
      auth: req.auth,
    });

    if (!printResult?.base64Pdf) {
      return res.status(500).json({ message: 'Failed to generate the document PDF.' });
    }

    const buffer = Buffer.from(printResult.base64Pdf, 'base64');
    const filename = buildDocumentFileName(documentType, docNum, docEntry);

    const template = await getMessageTemplate(metadata.documentType);
    const caption = template
      ? renderTemplate(template.template_body, {
        documentLabel: metadata.documentLabel,
        docNum: metadata.document?.docNum || docNum || docEntry,
        docEntry: metadata.document?.docEntry || docEntry,
        cardCode: metadata.document?.cardCode || cardCode || '',
        cardName: metadata.document?.cardName || '',
      })
      : '';

    await whatsappGraph.sendPdf(to, buffer, filename, caption);

    const customerId = await upsertCustomer(to, '');
    const conversationId = await getOrCreateOpenConversation(customerId);
    if (cardCode) {
      await whatsappDb.execute(
        `UPDATE whatsapp_customers SET card_code = @card_code, updated_at = CURRENT_TIMESTAMP WHERE id = @id AND (card_code IS NULL OR card_code = '')`,
        { id: customerId, card_code: cardCode },
      );
    }
    await insertMessage({
      conversationId,
      direction: 'outbound',
      messageType: 'document',
      body: caption ? `${filename}\n${caption}` : filename,
      sentByUserId: req.auth?.userId || null,
      isBot: false,
    });

    return res.json({ success: true, sentTo: to, filename, caption });
  } catch (error) {
    const message = error?.response?.data?.error?.message || error?.message || 'Failed to send document PDF.';
    return res.status(error?.statusCode || 500).json({ message });
  }
};

const getStats = async (_req, res) => {
  const totals = await whatsappDb.queryOne(
    `SELECT
      COUNT(*) AS total_conversations,
      SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open_conversations,
      SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending_conversations,
      SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed_conversations
    FROM whatsapp_conversations`,
  );

  const messageStats = await whatsappDb.queryOne(
    `SELECT
      COUNT(*) AS total_messages,
      SUM(CASE WHEN is_bot = 1 THEN 1 ELSE 0 END) AS bot_messages
    FROM whatsapp_messages`,
  );

  res.json({ ...totals, ...messageStats });
};

module.exports = {
  listConversations,
  getMessages,
  sendReply,
  updateConversationStatus,
  updateCustomerCardCode,
  sendDocumentPdf,
  listDocumentTypes,
  listMessageTemplates,
  upsertMessageTemplate,
  deleteMessageTemplate,
  getStats,
};
