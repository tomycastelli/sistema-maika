import "~/styles/globals.css";

import { Analytics } from "@vercel/analytics/react";

import { Inter } from "next/font/google";
import { headers } from "next/headers";

import { cn } from "~/lib/utils";
import { TRPCReactProvider } from "~/trpc/react";
import Navbar from "./components/Navbar";
import { ThemeProvider } from "./components/theme-provider";
import { Toaster } from "./components/ui/sonner";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata = {
  title: "Maika",
  description: "El Sistema de Maika",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <div
            className={cn(
              `font-sans ${inter.variable}`,
              "bg-background px-4 lg:px-8 min-h-screen",
            )}
          >
            <TRPCReactProvider headers={headers()}>
              <Navbar />
              <main className="h-full pb-8">
                {children}
                <Analytics />
                <Toaster />
              </main>
            </TRPCReactProvider>
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
