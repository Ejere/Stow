import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { useRouter } from "next/navigation";
import { SessionProvider } from "@/context/SessionProvider";
import { connectAndVerifyWallet, WalletConnectError } from "@/lib/wallet";
import { registerPasskey, PasskeyRegistrationError } from "@/lib/passkey";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";
import SignupPage from "./page";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn().mockReturnValue("/signup"),
  useSearchParams: vi.fn().mockReturnValue(new URLSearchParams()),
}));

vi.mock("@/lib/wallet", async () => {
  const actual = await vi.importActual<typeof import("@/lib/wallet")>("@/lib/wallet");
  return { ...actual, connectAndVerifyWallet: vi.fn() };
});

vi.mock("@/lib/passkey", async () => {
  const actual = await vi.importActual<typeof import("@/lib/passkey")>("@/lib/passkey");
  return { ...actual, registerPasskey: vi.fn() };
});

vi.mock("@simplewebauthn/browser", async () => {
  const actual = await vi.importActual<typeof import("@simplewebauthn/browser")>(
    "@simplewebauthn/browser",
  );
  return { ...actual, browserSupportsWebAuthn: vi.fn() };
});

const mockConnectAndVerifyWallet = connectAndVerifyWallet as unknown as ReturnType<typeof vi.fn>;
const mockRegisterPasskey = registerPasskey as unknown as ReturnType<typeof vi.fn>;
const mockBrowserSupportsWebAuthn = browserSupportsWebAuthn as unknown as ReturnType<typeof vi.fn>;

function renderSignupPage() {
  return render(
    <SessionProvider>
      <SignupPage />
    </SessionProvider>,
  );
}

const session = {
  access_token: "token-1",
  refresh_token: "refresh-1",
  user: { id: "user-1", stellar_address: "GADDR1" },
};

describe("SignupPage", () => {
  const mockPush = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useRouter as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
    });
    mockBrowserSupportsWebAuthn.mockReturnValue(true);
    window.localStorage.clear();
  });

  it("renders a wallet signup prompt", () => {
    renderSignupPage();
    expect(
      screen.getByRole("button", { name: /sign up with your wallet/i }),
    ).toBeInTheDocument();
  });

  it("connects the wallet, registers a passkey, sets the session, and routes to the dashboard", async () => {
    mockConnectAndVerifyWallet.mockResolvedValue(session);
    mockRegisterPasskey.mockResolvedValue({
      id: "wc-1",
      credential_id: "cred-1",
      device_type: "platform",
      backed_up: true,
      created_at: "2026-01-01T00:00:00.000Z",
    });

    renderSignupPage();
    fireEvent.click(screen.getByRole("button", { name: /sign up with your wallet/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
    expect(mockConnectAndVerifyWallet).toHaveBeenCalledTimes(1);
    expect(mockRegisterPasskey).toHaveBeenCalledTimes(1);
  });

  it("shows a graceful message and never attempts passkey registration when the browser doesn't support WebAuthn", async () => {
    mockBrowserSupportsWebAuthn.mockReturnValue(false);
    mockConnectAndVerifyWallet.mockResolvedValue(session);

    renderSignupPage();

    expect(screen.getByText(/doesn't support passkeys/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /sign up with your wallet/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
    expect(mockRegisterPasskey).not.toHaveBeenCalled();
  });

  it("still routes to the dashboard when passkey registration is cancelled after a successful wallet signup", async () => {
    mockConnectAndVerifyWallet.mockResolvedValue(session);
    mockRegisterPasskey.mockRejectedValue(
      new PasskeyRegistrationError("Passkey creation was cancelled or timed out.", true),
    );

    renderSignupPage();
    fireEvent.click(screen.getByRole("button", { name: /sign up with your wallet/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
  });

  it("does not crash and still routes to the dashboard when passkey registration fails outright after a successful wallet signup", async () => {
    mockConnectAndVerifyWallet.mockResolvedValue(session);
    mockRegisterPasskey.mockRejectedValue(
      new PasskeyRegistrationError("Couldn't save your passkey. Please try again."),
    );

    renderSignupPage();
    fireEvent.click(screen.getByRole("button", { name: /sign up with your wallet/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/dashboard"));
  });

  it("shows a clear error message and does not route when the wallet connection is cancelled", async () => {
    mockConnectAndVerifyWallet.mockRejectedValue(
      new WalletConnectError("Wallet connection was cancelled or denied.", true),
    );

    renderSignupPage();
    fireEvent.click(screen.getByRole("button", { name: /sign up with your wallet/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/cancelled or denied/i);
    expect(mockPush).not.toHaveBeenCalled();
    expect(mockRegisterPasskey).not.toHaveBeenCalled();
  });

  it("shows a clear error message when wallet verification fails outright", async () => {
    mockConnectAndVerifyWallet.mockRejectedValue(
      new WalletConnectError("Wallet verification failed, or the challenge expired. Please try again."),
    );

    renderSignupPage();
    fireEvent.click(screen.getByRole("button", { name: /sign up with your wallet/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/verification failed/i);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it("disables the button while the signup attempt is pending", async () => {
    let resolvePromise: (value: unknown) => void = () => {};
    mockConnectAndVerifyWallet.mockReturnValue(
      new Promise((resolve) => {
        resolvePromise = resolve;
      }),
    );

    renderSignupPage();
    const button = screen.getByRole("button", { name: /sign up with your wallet/i });
    fireEvent.click(button);

    expect(
      await screen.findByRole("button", { name: /setting up your account/i }),
    ).toBeDisabled();

    await act(async () => {
      resolvePromise(session);
    });
  });
});
