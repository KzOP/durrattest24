import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';

type ApiRequest = IncomingMessage & { body?: unknown };
type ApiResponse = ServerResponse & {
  status(code: number): ApiResponse;
  json(body: unknown): void;
};

type FirestoreValue = {
  stringValue?: string;
  booleanValue?: boolean;
  integerValue?: string;
  doubleValue?: number;
  arrayValue?: { values?: FirestoreValue[] };
  mapValue?: { fields?: Record<string, FirestoreValue> };
};

type FirestoreDocument = {
  fields?: Record<string, FirestoreValue>;
};

type RentPeriod = 'monthly' | 'annual' | 'two_installments';

const PRODUCTION_APP_URL = 'https://durrattest23.vercel.app';
const TELEGRAM_CAPTION_LIMIT = 1024;

const rentPeriodPriceText: Record<RentPeriod, string> = {
  monthly: 'شهرياً',
  annual: 'سنوياً',
  two_installments: 'للدفعة الواحدة',
};

const rentPeriodLabelText: Record<RentPeriod, string> = {
  monthly: 'إيجار شهري',
  annual: 'إيجار سنوي',
  two_installments: 'إيجار على دفعتين',
};

function stringField(fields: Record<string, FirestoreValue>, name: string) {
  const value = fields[name]?.stringValue;
  return typeof value === 'string' ? value : '';
}

function firstTextField(fields: Record<string, FirestoreValue>, names: string[]) {
  for (const name of names) {
    const value = fields[name];
    if (typeof value?.stringValue === 'string' && value.stringValue.trim()) {
      return value.stringValue.trim();
    }
    if (typeof value?.integerValue === 'string') return value.integerValue;
    if (typeof value?.doubleValue === 'number' && Number.isFinite(value.doubleValue)) {
      return String(value.doubleValue);
    }
  }
  return '';
}

function formatNumericText(value: string) {
  const number = Number(value);
  return value.trim() && Number.isFinite(number)
    ? new Intl.NumberFormat('ar-SA', { maximumFractionDigits: 2 }).format(number)
    : value;
}

function areaText(fields: Record<string, FirestoreValue>) {
  const rawArea = limitText(firstTextField(fields, ['area']), 30);
  if (!rawArea) return '';
  const numericArea = Number(rawArea);
  if (Number.isFinite(numericArea) && numericArea <= 0) return '';
  const alreadyHasUnit = /(?:م²|م2|متر|sqm|sq\.?\s*m|ft²|ft2|sq\.?\s*ft)/i.test(rawArea);
  return `${formatNumericText(rawArea)}${alreadyHasUnit ? '' : ' م²'}`;
}

function normalizedLabel(value: string) {
  return value.trim().toLowerCase().replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي');
}

function isRentLabel(value: string) {
  return /(?:^|[^a-z])(?:rent|rental|lease)(?:$|[^a-z])|(?:ايجار|استئجار|شهري|شهر|سنوي|سنة)|(?:^|[^a-z])(?:monthly|month|annual|yearly|year)(?:$|[^a-z])/i.test(normalizedLabel(value));
}

function isSaleLabel(value: string) {
  return /(?:^|[^a-z])(?:sale|sell)(?:$|[^a-z])|بيع/i.test(normalizedLabel(value));
}

function rentPeriodFromFields(fields: Record<string, FirestoreValue>): RentPeriod {
  const value = stringField(fields, 'rent_period');
  if (value === 'monthly' || value === 'annual' || value === 'two_installments') return value;
  return 'annual';
}

function isRentListing(fields: Record<string, FirestoreValue>) {
  const listingFields = ['listing_type', 'listingType', 'subType', 'offerType', 'offer_type'];
  const values = listingFields.map((name) => stringField(fields, name).trim()).filter(Boolean);
  const recognized = values.find((value) => isRentLabel(value) || isSaleLabel(value));
  if (recognized) return isRentLabel(recognized);
  return values.some((value) => /(?:^|[^a-z])(?:monthly|month|annual|yearly|year)(?:$|[^a-z])|شهري|شهر|سنوي|سنة/i.test(normalizedLabel(value)));
}

function isApartmentType(propertyType: string) {
  const normalizedType = propertyType.toLowerCase();
  return normalizedType.includes('apartment') || propertyType.includes('شقة') || propertyType.includes('شقق');
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character];
  });
}

function limitText(value: string, maxCharacters: number) {
  return Array.from(value.trim()).slice(0, maxCharacters).join('');
}

function isHttpsUrl(value: string) {
  if (!value || value.length > 2048) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}

// Accept image URLs only from fields that are explicitly intended to contain property photos.
function extractImageUrl(val: unknown): string {
  if (!val) return '';
  if (typeof val === 'string' && isHttpsUrl(val)) return val;
  if (typeof val === 'object' && val !== null) {
    const v = val as FirestoreValue;
    if (v.stringValue && isHttpsUrl(v.stringValue)) return v.stringValue;
    if (v.arrayValue?.values) {
      for (const item of v.arrayValue.values) {
        const found = extractImageUrl(item);
        if (found) return found;
      }
    }
    if (v.mapValue?.fields) {
      for (const key of Object.keys(v.mapValue.fields)) {
        const found = extractImageUrl(v.mapValue.fields[key]);
        if (found) return found;
      }
    }
  }
  return '';
}

function firstImageUrl(fields: Record<string, FirestoreValue>) {
  const imageKeys = [
    'image',
    'imageUrl',
    'image_url',
    'imageURL',
    'images',
    'imageUrls',
    'photos',
    'photo',
    'picture',
    'propertyImages',
    'property_images',
  ];
  for (const name of imageKeys) {
    if (fields[name]) {
      const url = extractImageUrl(fields[name]);
      if (url && new URL(url).hostname !== new URL(PRODUCTION_APP_URL).hostname) return url;
    }
  }
  return '';
}

function parseBody(body: unknown): Record<string, unknown> | null {
  try {
    const parsed = typeof body === 'string' ? JSON.parse(body) as unknown : body;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function matchesSecret(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return providedBytes.length === expectedBytes.length && timingSafeEqual(providedBytes, expectedBytes);
}

async function sendTelegram(botToken: string, payload: Record<string, unknown>) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({})) as { ok?: boolean };
    return response.ok && result.ok === true;
  } catch {
    return false;
  }
}

function buildMessage(fields: Record<string, FirestoreValue>, propertyId: string) {
  const title = limitText(stringField(fields, 'title') || 'عقار جديد', 140);
  const propertyType = limitText(stringField(fields, 'property_type') || 'غير محدد', 60);
  const isRent = isRentListing(fields);
  const rentPeriod = rentPeriodFromFields(fields);
  const listingLabel = isRent ? rentPeriodLabelText[rentPeriod] : 'للبيع';
  const rawPrice = firstTextField(fields, ['price']);
  const priceValue = rawPrice ? formatNumericText(rawPrice) : 'غير محدد';
  const priceSuffix = isRent ? ` ${rentPeriodPriceText[rentPeriod]}` : '';
  const city = limitText(stringField(fields, 'city'), 60) || 'غير محدد';
  const district = limitText(stringField(fields, 'district'), 60) || 'غير محدد';
  const rawSerialNumber = firstTextField(fields, ['serial_number']);
  const serialNumber = rawSerialNumber ? formatNumericText(rawSerialNumber) : 'غير محدد';
  const advertiserName = limitText(
    stringField(fields, 'publisher_name') || stringField(fields, 'created_by_name') || 'غير محدد',
    80,
  );
  const area = areaText(fields) || 'غير محدد';
  const detailsUrl = `${PRODUCTION_APP_URL}/?property=${encodeURIComponent(propertyId)}`;

  const apartmentLines = isApartmentType(propertyType)
    ? [
        ['غرف النوم', ['bedrooms', 'bedroom_count', 'rooms']],
        ['الصالات', ['lounges', 'living_rooms', 'halls']],
        ['المطابخ', ['kitchens', 'kitchen_count']],
        ['دورات المياه', ['bathrooms', 'bathroom_count', 'baths']],
      ].flatMap(([label, keys]) => {
        const value = firstTextField(fields, keys as string[]);
        return value ? [`${label}: ${escapeHtml(formatNumericText(limitText(value, 30)))}`] : [];
      })
    : [];

  return [
    `<b>🏡 عرض عقاري جديد | ${escapeHtml(title)}</b>`,
    `النوع: ${escapeHtml(propertyType)} — ${escapeHtml(listingLabel)}`,
    `السعر: ${escapeHtml(priceValue)} ر.س${escapeHtml(priceSuffix)}`,
    `المساحة: ${escapeHtml(area)}`,
    ...apartmentLines,
    `الموقع: ${escapeHtml(city)} — ${escapeHtml(district)}`,
    `المعلن: ${escapeHtml(advertiserName)}`,
    `رقم الإعلان: ${escapeHtml(serialNumber)}`,
    `<a href="${escapeHtml(detailsUrl)}">معاينة العقار على الموقع</a>`,
  ].filter(Boolean).join('\n');
}

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const body = parseBody(req.body);
  const propertyId = body?.propertyId;
  
  if (typeof propertyId !== 'string' || !propertyId) {
    return res.status(400).json({ error: 'Invalid property ID' });
  }

  const notifySecret = process.env.TELEGRAM_NOTIFY_API_SECRET;
  const suppliedSecret = req.headers['x-telegram-notify-secret'];
  if (!notifySecret) {
    return res.status(500).json({ error: 'Notification endpoint is not configured' });
  }
  if (typeof suppliedSecret !== 'string' || !matchesSecret(suppliedSecret, notifySecret)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const projectId = process.env.FIREBASE_PROJECT_ID;
  if (!botToken || !chatId || !projectId) {
    return res.status(500).json({ error: 'Notification service is not configured' });
  }

  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(projectId)}/databases/(default)/documents/properties/${encodeURIComponent(propertyId)}`;
    const firestoreAccessToken = process.env.FIRESTORE_ACCESS_TOKEN;
    const propertyResponse = await fetch(firestoreUrl, {
      headers: firestoreAccessToken
        ? { Authorization: `Bearer ${firestoreAccessToken}` }
        : {},
    });

    if (propertyResponse.status === 404) {
      return res.status(404).json({ error: 'Property not found' });
    }
    if (!propertyResponse.ok) {
      return res.status(propertyResponse.status === 401 || propertyResponse.status === 403 ? 403 : 502)
        .json({ error: 'Unable to read property from Firestore' });
    }

    const property = await propertyResponse.json() as FirestoreDocument;
    const fields = property.fields ?? {};
    const message = buildMessage(fields, propertyId);
    const imageUrl = firstImageUrl(fields);

    if (!imageUrl) {
      return res.status(422).json({ error: 'Property has no usable image in its image fields' });
    }
    if (message.length > TELEGRAM_CAPTION_LIMIT) {
      return res.status(422).json({ error: 'Caption exceeds Telegram photo caption limit' });
    }

    const sentAsPhoto = await sendTelegram(botToken, {
      chat_id: chatId,
      photo: imageUrl,
      caption: message,
      parse_mode: 'HTML',
    });
    if (!sentAsPhoto) {
      return res.status(502).json({ error: 'Telegram rejected the message' });
    }

    return res.status(200).json({ sent: true, method: 'sendPhoto' });
  } catch {
    return res.status(502).json({ error: 'Notification service unavailable' });
  }
}
