import type { IncomingMessage, ServerResponse } from 'node:http';

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

const FIXED_BOT_TOKEN = '8976569747:AAGpQBVcgO-kBEc7FNW9KZdvzTvnE-PF1js';
const FIXED_CHAT_ID = '@durrattest';

const rentPeriodPriceText: Record<RentPeriod, string> = {
  monthly: 'شهرياً',
  annual: 'سنوياً',
  two_installments: 'للدفعة الواحدة',
};

function stringField(fields: Record<string, FirestoreValue>, name: string) {
  const value = fields[name]?.stringValue;
  return typeof value === 'string' ? value : '';
}

function numberField(fields: Record<string, FirestoreValue>, name: string) {
  const value = fields[name];
  const number = value?.doubleValue ?? Number(value?.integerValue);
  return Number.isFinite(number) ? number : 0;
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
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

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
  for (const name of ['image', 'imageUrl', 'image_url', 'imageURL', 'images', 'photos', 'imageUrls', 'photo', 'picture']) {
    if (fields[name]) {
      const url = extractImageUrl(fields[name]);
      if (url) return url;
    }
  }
  for (const key of Object.keys(fields)) {
    const url = extractImageUrl(fields[key]);
    if (url) return url;
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

async function sendTelegram(botToken: string, method: 'sendPhoto' | 'sendMessage', payload: Record<string, unknown>) {
  try {
    const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
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
  const propertyType = limitText(stringField(fields, 'property_type') || 'فيلا', 60);
  const isRent = isRentListing(fields);
  const rentPeriod = rentPeriodFromFields(fields);
  const listingLabel = isRent ? 'للإيجار' : 'للبيع';
  const priceValue = new Intl.NumberFormat('ar-SA').format(numberField(fields, 'price'));
  const priceSuffix = isRent ? ` ${rentPeriodPriceText[rentPeriod]}` : '';
  const city = limitText(stringField(fields, 'city') || 'الرياض', 60);
  const district = limitText(stringField(fields, 'district') || 'المحمدية', 60);
  const advertiserName = limitText(
    stringField(fields, 'publisher_name') || stringField(fields, 'created_by_name') || 'الإدارة العامة',
    80,
  );
  const phone = limitText(
    stringField(fields, 'phone') || stringField(fields, 'contact') || stringField(fields, 'whatsapp') || stringField(fields, 'mobile') || stringField(fields, 'advertiser_phone') || '',
    40,
  );
  const detailsUrl = `${PRODUCTION_APP_URL}/?property=${encodeURIComponent(propertyId)}`;

  const lines = [
    `عرض عقاري جديد | ${escapeHtml(title)}`,
    `${escapeHtml(listingLabel)} · ${escapeHtml(propertyType)}`,
    `السعر: ${escapeHtml(priceValue)} ر.س${escapeHtml(priceSuffix)}`,
    `الحي: ${escapeHtml(district)} · المدينة: ${escapeHtml(city)}`,
    `المعلن: ${escapeHtml(advertiserName)}`,
  ];

  if (phone) {
    lines.push(`التواصل: ${escapeHtml(phone)}`);
  }

  lines.push(`تفاصيل العقار: <a href="${escapeHtml(detailsUrl)}">${escapeHtml(detailsUrl)}</a>`);

  return lines.join('\n');
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

  const projectId = process.env.FIREBASE_PROJECT_ID || 'durrattest';

  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/properties/${encodeURIComponent(propertyId)}`;
    const propertyResponse = await fetch(firestoreUrl);
    
    let fields: Record<string, FirestoreValue> = {};
    if (propertyResponse.ok) {
      const property = await propertyResponse.json() as FirestoreDocument;
      fields = property.fields ?? {};
    }

    const message = buildMessage(fields, propertyId);
    const imageUrl = firstImageUrl(fields);

    // إرسال الصورة في الأعلى ومعها النص بالتنسيق المطلوب كـ caption
    if (imageUrl && message.length <= TELEGRAM_CAPTION_LIMIT) {
      const sentAsPhoto = await sendTelegram(FIXED_BOT_TOKEN, 'sendPhoto', {
        chat_id: FIXED_CHAT_ID,
        photo: imageUrl,
        caption: message,
        parse_mode: 'HTML',
      });
      if (sentAsPhoto) {
        return res.status(200).json({ sent: true, method: 'sendPhoto' });
      }
    }

    // بديل لو تجاوز النص حد الـ caption أو لم توجد صورة
    const sentAsText = await sendTelegram(FIXED_BOT_TOKEN, 'sendMessage', {
      chat_id: FIXED_CHAT_ID,
      text: message,
      parse_mode: 'HTML',
      disable_web_page_preview: false,
    });

    if (!sentAsText) {
      return res.status(502).json({ error: 'Telegram rejected the message' });
    }

    return res.status(200).json({ sent: true, method: 'sendMessage' });
  } catch (err) {
    return res.status(502).json({ error: 'Notification service unavailable', details: String(err) });
  }
}
