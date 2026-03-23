import type { Metadata } from "next";
import "./globals.css";
import SummaryDoneNotification from "@/components/SummaryDoneNotification";
import { API_MAX_DURATION_SECONDS } from "@/lib/config";

export const maxDuration = API_MAX_DURATION_SECONDS

export const metadata: Metadata = {
  title: "My Youtube Signal",
  description: "Discover, summarize, and organize YouTube videos from your favorite channels",
  icons: {
    icon: '/favicon.ico',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var mode = localStorage.getItem('theme-mode');
            var tone = localStorage.getItem('theme-tone');
            if (!mode) mode = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
            if (mode === 'dark') document.documentElement.classList.add('dark');
            if (tone === 'beige') document.documentElement.classList.add('beige');
          } catch(e) {}
        `}} />
      </head>
      <body className="antialiased">
        {children}
        <SummaryDoneNotification />
      </body>
    </html>
  );
}
