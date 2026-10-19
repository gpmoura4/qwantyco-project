import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aurora — Assistente de Suporte",
  description: "Assistente de suporte com aprovação humana (desafio técnico Qwantyco)",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
