import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  loginWithPasskey,
  PasskeyLoginError,
  registerPasskey,
  PasskeyRegistrationError,
} from "./passkey";
import { api } from "@/lib/api";
import {
  WebAuthnError,
  startAuthentication,
  startRegistration,
  browserSupportsWebAuthn,
} from "@simplewebauthn/browser";

vi.mock("@simplewebauthn/browser", async () => {
  const actual = await vi.importActual<typeof import("@simplewebauthn/browser")>(
    "@simplewebauthn/browser",
  );
  return {
    ...actual,
    startAuthentication: vi.fn(),
    startRegistration: vi.fn(),
    browserSupportsWebAuthn: vi.fn(),
  };
});

vi.mock("@/lib/api", () => ({
  api: {
    post: vi.fn(),
  },
}));

const mockStartAuthentication = startAuthentication as unknown as ReturnType<typeof vi.fn>;
const mockStartRegistration = startRegistration as unknown as ReturnType<typeof vi.fn>;
const mockBrowserSupportsWebAuthn = browserSupportsWebAuthn as unknown as ReturnType<typeof vi.fn>;
const mockApiPost = api.post as unknown as ReturnType<typeof vi.fn>;

describe("loginWithPasskey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowserSupportsWebAuthn.mockReturnValue(true);
  });

  it("throws immediately when the browser doesn't support WebAuthn", async () => {
    mockBrowserSupportsWebAuthn.mockReturnValue(false);

    await expect(loginWithPasskey()).rejects.toThrow(PasskeyLoginError);
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("completes the full begin -> assertion -> finish ceremony and returns the session", async () => {
    const options = { challenge: "chal-1" };
    const assertion = { id: "cred-1" };
    const session = {
      access_token: "token-1",
      refresh_token: "refresh-1",
      user: { id: "user-1", stellar_address: "GADDR1" },
    };

    mockApiPost.mockResolvedValueOnce(options).mockResolvedValueOnce(session);
    mockStartAuthentication.mockResolvedValueOnce(assertion);

    const result = await loginWithPasskey();

    expect(mockApiPost).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/passkey/authenticate/begin",
      undefined,
      { skipAuth: true },
    );
    expect(mockStartAuthentication).toHaveBeenCalledWith({ optionsJSON: options });
    expect(mockApiPost).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/passkey/authenticate/finish",
      { response: assertion },
      { skipAuth: true },
    );
    expect(result).toEqual(session);
  });

  it("marks a cancelled/dismissed prompt as cancelled", async () => {
    mockApiPost.mockResolvedValueOnce({ challenge: "chal-1" });
    const cause = new DOMException("The user cancelled", "NotAllowedError");
    mockStartAuthentication.mockRejectedValueOnce(
      new WebAuthnError({ message: "cancelled", code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", cause }),
    );

    await expect(loginWithPasskey()).rejects.toMatchObject({
      cancelled: true,
    });
  });

  it("surfaces a non-cancellation assertion failure as a non-cancelled error", async () => {
    mockApiPost.mockResolvedValueOnce({ challenge: "chal-1" });
    const cause = new DOMException("Something else went wrong", "UnknownError");
    mockStartAuthentication.mockRejectedValueOnce(
      new WebAuthnError({ message: "failed", code: "ERROR_AUTHENTICATOR_GENERAL_ERROR", cause }),
    );

    await expect(loginWithPasskey()).rejects.toMatchObject({
      cancelled: false,
    });
  });

  it("wraps a finish-step failure (unrecognized/expired passkey) in PasskeyLoginError", async () => {
    mockApiPost
      .mockResolvedValueOnce({ challenge: "chal-1" })
      .mockRejectedValueOnce(new Error("401"));
    mockStartAuthentication.mockResolvedValueOnce({ id: "cred-1" });

    await expect(loginWithPasskey()).rejects.toThrow(PasskeyLoginError);
  });
});

describe("registerPasskey", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBrowserSupportsWebAuthn.mockReturnValue(true);
  });

  it("throws immediately when the browser doesn't support WebAuthn", async () => {
    mockBrowserSupportsWebAuthn.mockReturnValue(false);

    await expect(registerPasskey()).rejects.toThrow(PasskeyRegistrationError);
    expect(mockApiPost).not.toHaveBeenCalled();
  });

  it("completes the full begin -> attestation -> finish ceremony and returns the credential", async () => {
    const options = { challenge: "chal-1" };
    const attestation = { id: "cred-1" };
    const credential = {
      id: "wc-1",
      credential_id: "cred-1",
      device_type: "platform",
      backed_up: true,
      created_at: "2026-01-01T00:00:00.000Z",
    };

    mockApiPost.mockResolvedValueOnce(options).mockResolvedValueOnce(credential);
    mockStartRegistration.mockResolvedValueOnce(attestation);

    const result = await registerPasskey();

    expect(mockApiPost).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/passkey/register/begin",
      undefined,
    );
    expect(mockStartRegistration).toHaveBeenCalledWith({ optionsJSON: options });
    expect(mockApiPost).toHaveBeenNthCalledWith(
      2,
      "/api/v1/auth/passkey/register/finish",
      { response: attestation },
    );
    expect(result).toEqual(credential);
  });

  it("passes a provided display name through to the begin call", async () => {
    mockApiPost.mockResolvedValueOnce({ challenge: "chal-1" }).mockResolvedValueOnce({});
    mockStartRegistration.mockResolvedValueOnce({ id: "cred-1" });

    await registerPasskey("My Phone");

    expect(mockApiPost).toHaveBeenNthCalledWith(
      1,
      "/api/v1/auth/passkey/register/begin",
      { display_name: "My Phone" },
    );
  });

  it("does not pass skipAuth, so the session token is attached like any authenticated call", async () => {
    mockApiPost.mockResolvedValueOnce({ challenge: "chal-1" }).mockResolvedValueOnce({});
    mockStartRegistration.mockResolvedValueOnce({ id: "cred-1" });

    await registerPasskey();

    for (const call of mockApiPost.mock.calls) {
      expect(call[2]).toBeUndefined();
    }
  });

  it("marks a cancelled/dismissed prompt as cancelled", async () => {
    mockApiPost.mockResolvedValueOnce({ challenge: "chal-1" });
    const cause = new DOMException("The user cancelled", "NotAllowedError");
    mockStartRegistration.mockRejectedValueOnce(
      new WebAuthnError({ message: "cancelled", code: "ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY", cause }),
    );

    await expect(registerPasskey()).rejects.toMatchObject({
      cancelled: true,
    });
  });

  it("surfaces a non-cancellation attestation failure as a non-cancelled error", async () => {
    mockApiPost.mockResolvedValueOnce({ challenge: "chal-1" });
    const cause = new DOMException("Something else went wrong", "UnknownError");
    mockStartRegistration.mockRejectedValueOnce(
      new WebAuthnError({ message: "failed", code: "ERROR_AUTHENTICATOR_GENERAL_ERROR", cause }),
    );

    await expect(registerPasskey()).rejects.toMatchObject({
      cancelled: false,
    });
  });

  it("wraps a finish-step failure (backend rejection) in PasskeyRegistrationError", async () => {
    mockApiPost
      .mockResolvedValueOnce({ challenge: "chal-1" })
      .mockRejectedValueOnce(new Error("401"));
    mockStartRegistration.mockResolvedValueOnce({ id: "cred-1" });

    await expect(registerPasskey()).rejects.toThrow(PasskeyRegistrationError);
  });
});
