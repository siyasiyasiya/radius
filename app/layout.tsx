// app/layout.tsx
import "./globals.css";
import type { Metadata } from "next";
import SolanaProvider from "./components/SolanaProvider";

export const metadata: Metadata = {
  title: "Radius",
  description: "Hyperlocal prediction markets",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <SolanaProvider>{children}</SolanaProvider>
      </body>
    </html>
  );
}
