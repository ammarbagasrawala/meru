"use client";

import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { wagmiConfig } from "@/lib/wagmi";
import { ToastProvider } from "@/components/Toast";

/**
 * Wraps the React tree with WagmiProvider + QueryClientProvider.
 * Wagmi v2 requires both — without QueryClientProvider, any wagmi hook silently no-ops.
 */
export default function Providers({ children }: { children: ReactNode }) {
  // Each browser session gets one QueryClient — created in state so it survives Fast Refresh.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            retry: 1,
            staleTime: 30_000,
            refetchOnWindowFocus: false,
          },
        },
      })
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ToastProvider>{children}</ToastProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
