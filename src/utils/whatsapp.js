const MANUAL_WHATSAPP_ENDPOINT = (process.env.REACT_APP_MANUAL_WHATSAPP_FUNCTION_URL || '').trim();

export const getManualWhatsAppEndpoint = () => MANUAL_WHATSAPP_ENDPOINT;

export const isManualWhatsAppConfigured = () => MANUAL_WHATSAPP_ENDPOINT.length > 0;

const normalizeTimestamp = (value) => {
  if (!value) {
    return undefined;
  }

  if (value instanceof Date) {
    try {
      const isoValue = value.toISOString();
      if (isoValue && isoValue !== 'Invalid Date') {
        return isoValue;
      }
    } catch (error) {
      return undefined;
    }
    return undefined;
  }

  if (typeof value === 'string' && value.trim().length > 0) {
    return value;
  }

  if (typeof value?.toDate === 'function') {
    try {
      const asDate = value.toDate();
      if (asDate instanceof Date) {
        return normalizeTimestamp(asDate);
      }
    } catch (error) {
      return undefined;
    }
  }

  return undefined;
};

export async function sendManualWhatsAppAlert({ mediaUrl, locationId, timestamp, signal } = {}) {
  if (!isManualWhatsAppConfigured()) {
    throw new Error('WhatsApp alert endpoint is not configured');
  }

  if (typeof mediaUrl !== 'string' || mediaUrl.trim().length === 0) {
    throw new Error('A media URL is required to send the WhatsApp alert');
  }

  if (typeof locationId !== 'string' || locationId.trim().length === 0) {
    throw new Error('A locationId is required to send the WhatsApp alert');
  }

  const payload = {
    gcp_url: mediaUrl,
    media_url: mediaUrl,
    locationId,
  };

  const normalizedTimestamp = normalizeTimestamp(timestamp);
  if (normalizedTimestamp) {
    payload.timestamp = normalizedTimestamp;
  }

  const response = await fetch(MANUAL_WHATSAPP_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal,
  });

  let data = null;
  try {
    data = await response.json();
  } catch (error) {
    data = null;
  }

  if (!response.ok) {
    const message = data?.error || response.statusText || 'Failed to send WhatsApp alert';
    const error = new Error(message);
    error.status = response.status;
    error.details = data;
    throw error;
  }

  return data;
}

export default sendManualWhatsAppAlert;
