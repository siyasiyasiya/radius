"use client";

import { ReactNode, useMemo, useState, useEffect } from "react";
import {
  ConnectionProvider,
  WalletProvider,
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { clusterApiUrl } from "@solana/web3.js";

import "@solana/wallet-adapter-react-ui/styles.css";

type Props = {
  children: ReactNode;
};

export default function SolanaProvider({ children }: Props) {
  const endpoint = useMemo(
    () => process.env.NEXT_PUBLIC_RPC_URL || clusterApiUrl("devnet"),
    []
  );

  // Always create the Phantom adapter - it handles detection internally
  const wallets = useMemo(() => [new PhantomWalletAdapter()], []);

  // Clear any stale wallet connection state on mount
  useEffect(() => {
    // Clear potentially corrupted wallet state
    try {
      const walletName = localStorage.getItem('walletName');
      if (walletName) {
        console.log('Found cached wallet:', walletName);
      }
    } catch (e) {
      // Ignore localStorage errors
    }
  }, []);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider 
        wallets={wallets} 
        autoConnect={false}
        onError={(error) => {
          console.error("Wallet error:", error);
          // Clear wallet state on error to prevent stuck "Connecting" state
          try {
            localStorage.removeItem('walletName');
          } catch (e) {
            // Ignore
          }
        }}
      >
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
