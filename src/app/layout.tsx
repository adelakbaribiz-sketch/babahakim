import type { Metadata } from "next";
import { Vazirmatn } from "next/font/google";
import { ThemeProvider } from "next-themes";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const vazir = Vazirmatn({
  variable: "--font-vazir",
  subsets: ["arabic", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "باباحکیم | BabaHakim — پلتفرم هوشمند تشخیص از تصویر زبان",
  description:
    "باباحکیم — پلتفرم دو زبانه تحلیل تصویر زبان با هوش مصنوعی، بازبینی کارشناسان و تأیید پزشک — BabaHakim AI-Assisted tongue diagnosis platform.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fa" dir="rtl" suppressHydrationWarning>
      <body className={`${vazir.variable} font-sans antialiased bg-background text-foreground`}>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false} disableTransitionOnChange>
          {children}
        </ThemeProvider>
        {/* radix toaster (legacy use-toast) — kept for backwards compatibility;
            sonner AppToaster (dir-aware) is rendered inside AppProvider (page.tsx) */}
        <Toaster />
      </body>
    </html>
  );
}
