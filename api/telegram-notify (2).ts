import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { propertyId } = req.body;
    
    // التوكن والشات آيدي مثبتة هنا مباشرة لضمان العمل بدون مشاكل في البيئة
    const botToken = '8976569747:AAGpQBVcgO-kBEc7FNW9KZdvzTvnE-PF1js';
    const chatId = '@durrattest';

    const message = `🏠 تم إضافة عقار جديد بنجاح!\n📌 رقم العقار: ${propertyId || 'جديد'}`;

    const telegramUrl = `https://api.telegram.org/bot${botToken}/sendMessage`;
    
    const response = await fetch(telegramUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
      }),
    });

    const data = await response.json();

    if (!data.ok) {
      console.error('Telegram Error:', data);
      return res.status(500).json({ error: 'Telegram API failed', details: data });
    }

    return res.status(200).json({ success: true, message: 'Notification sent successfully' });
  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}
