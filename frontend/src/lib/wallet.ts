import { api } from "@/lib/api";

export class WalletConnectError extends Error {
  /** True when the user dismissed the wallet's connect/sign prompt rather than it failing outright. */
  cancelled: boolean;

  constructor(message: string, cancelled = false) {
    super(message);
    this.name = "WalletConnectError";
    this.cancelled = cancelled;
  }
}

export interface WalletVerifyResult {
  access_token: string;
  refresh_token: string;
  user: { id: string; stellar_address: string; [key: string]: unknown };
}

/**
 * Minimal shape of the Freighter browser-extension API (window.freighterApi)
 * that this app relies on. Freighter is the de facto standard Stellar wallet
 * extension; other wallets that inject the same global are supported for
 * free. See https://docs.freighter.app for the full API.
 */
interface FreighterApi {
  isConnected: () => Promise<{ isConnected: boolean }>;
  requestAccess: () => Promise<{ address?: string; error?: string }>;
  signMessage: (
    message: string,
    opts?: { address?: string },
  ) => Promise<{ signedMessage?: string; error?: string }>;
}

declare global {
  interface Window {
    freighterApi?: FreighterApi;
  }
}

/** True when a Stellar wallet extension exposing the Freighter API is present. */
export function browserSupportsWallet(): boolean {
  return typeof window !== "undefined" && !!window.freighterApi;
}

/**
 * Connects to the browser's Stellar wallet extension, signs a fresh
 * challenge for the connected address, and exchanges the signed challenge
 * for a session. For a brand-new stellar_address the backend's
 * verifyChallenge call creates the account on the spot, so this doubles as
 * the app's account-creation primitive (see auth.service.ts
 * verifySignature). Throws WalletConnectError with a user-facing message on
 * any failure, distinguishing a user-cancelled prompt from a real error.
 */
export async function connectAndVerifyWallet(): Promise<WalletVerifyResult> {
  if (!browserSupportsWallet()) {
    throw new WalletConnectError(
      "No Stellar wallet extension was found. Install a wallet like Freighter and try again.",
    );
  }

  const freighterApi = window.freighterApi!;

  let address: string;
  try {
    const access = await freighterApi.requestAccess();
    if (access.error || !access.address) {
      throw new WalletConnectError(
        access.error || "Wallet connection was cancelled or denied.",
        true,
      );
    }
    address = access.address;
  } catch (err) {
    if (err instanceof WalletConnectError) throw err;
    throw new WalletConnectError(
      "Couldn't connect to your wallet. Please try again.",
    );
  }

  const { challenge } = await api.post<{ challenge: string }>(
    "/api/v1/auth/challenge",
    { stellar_address: address },
    { skipAuth: true },
  );

  let signedMessage: string;
  try {
    const signed = await freighterApi.signMessage(challenge, { address });
    if (signed.error || !signed.signedMessage) {
      throw new WalletConnectError(
        signed.error || "Signature request was cancelled or denied.",
        true,
      );
    }
    signedMessage = signed.signedMessage;
  } catch (err) {
    if (err instanceof WalletConnectError) throw err;
    throw new WalletConnectError(
      "Couldn't complete the wallet signature. Please try again.",
    );
  }

  try {
    return await api.post<WalletVerifyResult>(
      "/api/v1/auth/verify",
      { stellar_address: address, signed_challenge: signedMessage },
      { skipAuth: true },
    );
  } catch {
    throw new WalletConnectError(
      "Wallet verification failed, or the challenge expired. Please try again.",
    );
  }
}
