const axios = require('axios');

function evidenceFields(order) {
  const firstItem = order.lineItems?.[0];
  return {
    product_description: (order.lineItems || []).map((item) => `${item.quantity} × ${item.title}`).join('; ') || undefined,
    shipping_carrier: order.shipping?.carrier,
    shipping_tracking_number: order.shipping?.trackingNumber,
    shipping_date: order.shipping?.shippedAt ? order.shipping.shippedAt.toISOString().slice(0, 10) : undefined,
    customer_communication: (order.communications || []).map((item) => item.body).filter(Boolean).join('\n\n') || undefined,
    uncategorized_text: firstItem ? `Order ${order.orderNumber} contains ${firstItem.title}${order.lineItems.length > 1 ? ` and ${order.lineItems.length - 1} other item(s)` : ''}.` : undefined,
  };
}

function buildContext(dispute, order) {
  return {
    dispute: { reason: dispute.reason, amount: `${(dispute.amountCents / 100).toFixed(2)} ${String(dispute.currency).toUpperCase()}`, respondBy: dispute.respondBy?.toISOString().slice(0, 10) },
    order: {
      number: order.orderNumber,
      chargedAt: order.charge?.chargedAt?.toISOString().slice(0, 10),
      items: (order.lineItems || []).map(({ title, quantity }) => ({ title, quantity })),
      shipping: { carrier: order.shipping?.carrier, trackingNumber: order.shipping?.trackingNumber, shippedAt: order.shipping?.shippedAt?.toISOString().slice(0, 10), deliveredAt: order.shipping?.deliveredAt?.toISOString().slice(0, 10), deliveryStatus: order.shipping?.deliveryStatus },
      communications: (order.communications || []).map(({ source, body, occurredAt }) => ({ source, body, occurredAt })),
    },
  };
}

async function generateNarrative(dispute, order) {
  if (!process.env.GROQ_API_KEY) {
    const error = new Error('GROQ_API_KEY is not configured');
    error.status = 500;
    throw error;
  }
  const response = await axios.post('https://api.groq.com/openai/v1/chat/completions', {
    model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
    temperature: 0,
    max_tokens: 700,
    messages: [
      { role: 'system', content: 'You draft concise chargeback evidence for merchant review. Use only the supplied facts. Never claim delivery, authorization, customer intent, or communication that is not explicitly present. If evidence is missing, say so plainly. Do not include addresses, email addresses, or payment identifiers. Return only the proposed narrative, with no title or commentary.' },
      { role: 'user', content: `Draft evidence addressing this dispute. Facts:\n${JSON.stringify(buildContext(dispute, order))}` },
    ],
  }, { headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.GROQ_API_KEY}` }, timeout: 30000 });
  const narrative = response.data?.choices?.[0]?.message?.content?.trim();
  if (!narrative) throw new Error('Evidence provider returned no narrative');
  return narrative;
}

module.exports = { evidenceFields, generateNarrative };
