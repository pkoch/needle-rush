import type { Metadata } from "next";
import "./globals.css";
import "./entry.css";
import "./leaderboard.css";
import "./finale.css";
export const metadata: Metadata={title:"Needle Rush — Beat the room",description:"A TV-first music party game. Ten songs, four choices, one quick guess.",icons:{icon:"/favicon.svg"}};
export default function RootLayout({children}:Readonly<{children:React.ReactNode}>){return <html lang="en"><body>{children}</body></html>}
