import type { Metadata } from "next";
import "./globals.css";
import FeedbackChatClient from "./feedback-chat-client";

export const metadata: Metadata = {
  title: "botPhone",
  description: "Interactive voice bot — places phone calls and runs conversation flows (song-request, more to come) using BT audio injection, TTS, and STT.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}
        <FeedbackChatClient />
</body>
    </html>
  );
}
