import "./globals.css";
import SolanaProvider from "./components/SolanaProvider";

export const metadata = {
  title: "Radius Markets",
  description: "Hyperlocal prediction markets with ZK-gated location.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-slate-950 text-slate-50">
        <SolanaProvider>{children}</SolanaProvider>
      </body>
    </html>
  );
}
