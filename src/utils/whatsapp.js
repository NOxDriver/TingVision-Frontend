const MANUAL_WHATSAPP_ALERT_URL = (
  process.env.REACT_APP_WHATSAPP_ALERT_URL
  || process.env.REACT_APP_SEND_MANUAL_WHATSAPP_ALERT_URL
  || ''
).trim();

const isNonEmptyString = (value) => typeof value === 'string' && value.trim().length > 0;

export const getManualWhatsAppAlertUrl = () => MANUAL_WHATSAPP_ALERT_URL;

export const isWhatsAppAlertConfigured = () => isNonEmptyString(MANUAL_WHATSAPP_ALERT_URL);

const buildRequestPayload = ({ mediaUrl, locationId, timestamp, mediaType }) => {
  if (!isNonEmptyString(mediaUrl)) {
    throw new Error('A media URL is required to send a WhatsApp alert.');
  }

  if (!isNonEmptyString(locationId)) {
    throw new Error('A location ID is required to send a WhatsApp alert.');
  }

  const payload = {
    gcp_url: mediaUrl.trim(),
    locationId: locationId.trim(),
  };

  if (isNonEmptyString(timestamp)) {
    payload.timestamp = timestamp.trim();
  }

  if (isNonEmptyString(mediaType)) {
    payload.mediaType = mediaType.trim();
  }

  return payload;
};

export const sendManualWhatsAppAlert = async ({ mediaUrl, locationId, timestamp, mediaType }) => {
  if (!isWhatsAppAlertConfigured()) {
    throw new Error('WhatsApp alert service URL is not configured.');
  }

  const payload = buildRequestPayload({ mediaUrl, locationId, timestamp, mediaType });

  const response = await fetch(MANUAL_WHATSAPP_ALERT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const contentType = response.headers.get('content-type') || '';
  let data = null;

  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => null);
  } else {
    const text = await response.text().catch(() => '');
    if (text) {
      data = { message: text };
    }
  }

  if (!response.ok) {
    const message = (data && (data.error || data.message))
      || `WhatsApp alert request failed with status ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.response = data;
    throw error;
  }

  return data || { status: 'ok' };
};

