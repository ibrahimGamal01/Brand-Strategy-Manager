export async function renderPdfFromHtml(html: string): Promise<Buffer> {
  // Lazy-load puppeteer to keep startup light in API workers.
  const puppeteer = require('puppeteer');

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const pdf = await page.pdf({
      format: 'Letter',
      printBackground: true,
      margin: {
        top: '0.6in',
        right: '0.6in',
        bottom: '0.6in',
        left: '0.6in',
      },
    });
    return Buffer.from(pdf);
  } finally {
    await browser.close();
  }
}
