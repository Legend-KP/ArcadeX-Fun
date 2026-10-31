/** QR encoder from the MIT-licensed uqr package. */
export function renderSVG(
  data: string,
  options?: {
    pixelSize?: number;
    whiteColor?: string;
    blackColor?: string;
    ecc?: "L" | "M" | "Q" | "H";
    border?: number;
  }
): string;
