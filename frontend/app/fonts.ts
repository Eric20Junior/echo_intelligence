import { Source_Serif_4, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";

export const serif = Source_Serif_4({ subsets: ["latin"], variable: "--font-serif", weight: ["400", "500", "600"] });
export const sans = IBM_Plex_Sans({ subsets: ["latin"], variable: "--font-sans", weight: ["400", "500", "600", "700"] });
export const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--font-mono", weight: ["400", "500"] });
