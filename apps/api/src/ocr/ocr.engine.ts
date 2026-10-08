import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';

export interface OcrResult {
  text: string;
  /** 0..1 */
  confidence: number;
}

export interface OcrEngine {
  readonly name: string;
  recognize(image: Buffer): Promise<OcrResult>;
}

export const OCR_ENGINE = Symbol('OCR_ENGINE');

/**
 * Moteur OCR local (Tesseract, francais + anglais) : aucun service payant, aucune donnee envoyee a un tiers.
 * Les donnees de langue sont telechargees une fois puis mises en cache ; en environnement sans acces Internet,
 * pointer OCR_LANG_PATH vers un dossier contenant fra.traineddata et eng.traineddata.
 * Alternative sans cout serveur : faire l'OCR dans le navigateur (tesseract.js cote client) et envoyer
 * uniquement le texte (champ rawText) -- c'est aussi ce qui permet l'OCR hors ligne a la reception.
 */
@Injectable()
export class TesseractEngine implements OcrEngine {
  readonly name = 'tesseract';
  private readonly logger = new Logger(TesseractEngine.name);

  async recognize(image: Buffer): Promise<OcrResult> {
    let createWorker: typeof import('tesseract.js').createWorker;
    try {
      ({ createWorker } = await import('tesseract.js'));
    } catch {
      throw new ServiceUnavailableException('Moteur OCR indisponible sur ce serveur : envoyez le texte lu par le navigateur (rawText).');
    }
    const worker = await createWorker(['fra', 'eng'], 1, {
      ...(process.env.OCR_LANG_PATH ? { langPath: process.env.OCR_LANG_PATH, gzip: false } : {}),
      cachePath: process.env.OCR_CACHE_PATH ?? undefined,
      logger: () => undefined,
    });
    try {
      const { data } = await worker.recognize(image);
      return { text: data.text ?? '', confidence: Math.max(0, Math.min(1, (data.confidence ?? 0) / 100)) };
    } catch (e) {
      this.logger.error(`OCR en echec : ${(e as Error).message}`);
      throw new ServiceUnavailableException('La lecture de l\'image a echoue. Reessayez avec une photo plus nette.');
    } finally {
      await worker.terminate();
    }
  }
}
