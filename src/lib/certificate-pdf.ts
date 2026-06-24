import { PDFDocument, PDFFont, PDFPage, PDFString, StandardFonts, rgb } from "pdf-lib";
import QRCode from "qrcode";

export type CertData = {
  nome: string;
  atividade: string;
  carga_horaria: number;
  data: string; // dd/mm/aaaa
  verificationCode: string;
  verifyUrl: string;
};

const C = {
  ink: rgb(0.07, 0.08, 0.22),
  body: rgb(0.25, 0.25, 0.34),
  muted: rgb(0.45, 0.44, 0.56),
  primary: rgb(0.23, 0.18, 0.68),
  primary2: rgb(0.44, 0.32, 0.84),
  lavender: rgb(0.91, 0.88, 1),
  paper: rgb(0.995, 0.995, 1),
  line: rgb(0.78, 0.73, 0.94),
};

function safeText(value: string) {
  return value.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").trim();
}

function centerX(page: PDFPage, text: string, size: number, font: PDFFont) {
  return (page.getWidth() - font.widthOfTextAtSize(text, size)) / 2;
}

function drawCentered(page: PDFPage, text: string, y: number, size: number, font: PDFFont, color = C.ink) {
  page.drawText(safeText(text), { x: centerX(page, safeText(text), size, font), y, size, font, color });
}

function drawFitCentered(page: PDFPage, text: string, y: number, size: number, minSize: number, maxWidth: number, font: PDFFont, color = C.ink) {
  const clean = safeText(text);
  let finalSize = size;
  while (font.widthOfTextAtSize(clean, finalSize) > maxWidth && finalSize > minSize) finalSize -= 1;
  drawCentered(page, clean, y, finalSize, font, color);
  return finalSize;
}

function wrapLines(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = safeText(text).split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const test = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(test, size) > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function codeLines(code: string) {
  return (code || "").match(/.{1,16}/g) ?? [""];
}

export async function generateCertificatePdf(
  _templateBytes: Uint8Array | null,
  data: CertData,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const W = 842;
  const H = 595;
  const page = pdf.addPage([W, H]);

  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const reg = await pdf.embedFont(StandardFonts.Helvetica);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);

  page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: C.paper });
  page.drawRectangle({ x: 0, y: H - 22, width: W, height: 22, color: C.primary });
  page.drawRectangle({ x: 0, y: H - 27, width: W, height: 5, color: C.primary2 });
  page.drawRectangle({ x: 0, y: 0, width: W, height: 10, color: C.lavender });

  const M = 42;
  page.drawRectangle({ x: M, y: M, width: W - M * 2, height: H - M * 2 - 27, borderColor: C.line, borderWidth: 1.3 });
  page.drawRectangle({ x: M + 9, y: M + 9, width: W - (M + 9) * 2, height: H - (M + 9) * 2 - 27, borderColor: C.line, borderWidth: 0.55 });

  page.drawRectangle({ x: M + 9, y: H - 112, width: W - (M + 9) * 2, height: 1, color: C.lavender });
  drawCentered(page, "CONGRESSO UNIFICADO UFLA PARAISO", H - 80, 9, bold, C.primary);

  drawCentered(page, "CERTIFICADO", H - 150, 45, bold, C.ink);
  drawCentered(page, "DE PARTICIPACAO", H - 177, 13, italic, C.muted);

  drawCentered(page, "CERTIFICAMOS QUE", H - 225, 12, reg, C.body);
  const name = safeText(data.nome).toUpperCase();
  const nameSize = drawFitCentered(page, name, H - 268, 32, 20, W - 170, bold, C.primary);
  const nameWidth = bold.widthOfTextAtSize(name, nameSize);
  page.drawLine({
    start: { x: (W - nameWidth) / 2 - 24, y: H - 283 },
    end: { x: (W + nameWidth) / 2 + 24, y: H - 283 },
    thickness: 0.9,
    color: C.line,
  });

  const body = `participou de "${data.atividade}", com carga horaria total de ${data.carga_horaria} hora${data.carga_horaria === 1 ? "" : "s"}.`;
  const lines = wrapLines(body, reg, 14, W - 210);
  let bodyY = H - 327;
  for (const line of lines) {
    drawCentered(page, line, bodyY, 14, reg, C.body);
    bodyY -= 20;
  }

  const footerY = 92;
  page.drawText("EMITIDO EM", { x: 92, y: footerY + 52, size: 8, font: bold, color: C.muted });
  page.drawText(data.data, { x: 92, y: footerY + 31, size: 13, font: bold, color: C.ink });
  page.drawLine({ start: { x: 92, y: footerY + 21 }, end: { x: 220, y: footerY + 21 }, thickness: 0.7, color: C.line });
  page.drawText("Data de emissao", { x: 92, y: footerY + 6, size: 8, font: reg, color: C.muted });

  const sigCenter = W / 2;
  page.drawLine({ start: { x: sigCenter - 108, y: footerY + 21 }, end: { x: sigCenter + 108, y: footerY + 21 }, thickness: 0.7, color: C.line });
  drawCentered(page, "COMISSAO ORGANIZADORA", footerY + 5, 9, bold, C.ink);
  drawCentered(page, "Congresso Unificado UFLA Paraiso", footerY - 9, 8, reg, C.muted);

  const qrDataUrl = await QRCode.toDataURL(data.verifyUrl, {
    margin: 0,
    width: 360,
    color: { dark: "#3a2daf", light: "#ffffff" },
  });
  const qrPng = await pdf.embedPng(qrDataUrl);
  const qrSize = 84;
  const qrX = W - 174;
  const qrY = footerY - 8;
  page.drawRectangle({ x: qrX - 10, y: qrY - 10, width: qrSize + 20, height: qrSize + 20, color: rgb(1, 1, 1), borderColor: C.line, borderWidth: 0.8 });
  page.drawImage(qrPng, { x: qrX, y: qrY, width: qrSize, height: qrSize });

  const linkAnnotation = pdf.context.register(
    pdf.context.obj({
      Type: "Annot",
      Subtype: "Link",
      Rect: [qrX - 10, qrY - 10, qrX + qrSize + 10, qrY + qrSize + 10],
      Border: [0, 0, 0],
      A: {
        Type: "Action",
        S: "URI",
        URI: PDFString.of(data.verifyUrl),
      },
    }),
  );
  page.node.addAnnot(linkAnnotation);

  const codeX = W - 330;
  page.drawText("AUTENTICIDADE", { x: codeX, y: footerY + 58, size: 8, font: bold, color: C.muted });
  page.drawText("Codigo de verificacao", { x: codeX, y: footerY + 42, size: 8, font: reg, color: C.muted });
  codeLines(data.verificationCode).slice(0, 3).forEach((line, idx) => {
    page.drawText(line, { x: codeX, y: footerY + 25 - idx * 12, size: 9.5, font: bold, color: C.primary });
  });
  page.drawText("Link seguro no QR Code", { x: codeX, y: footerY - 17, size: 7.5, font: reg, color: C.muted });

  return await pdf.save();
}
