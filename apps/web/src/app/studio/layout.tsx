import { IBM_Plex_Sans, JetBrains_Mono } from "next/font/google";

import "./console.css";
import "./workspace.css";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex",
});
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-jbm" });

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return <div className={`rq-console ${plex.variable} ${mono.variable}`}>{children}</div>;
}
