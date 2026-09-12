import { useState, useEffect, useRef } from "react";
import { Form, ActionPanel, Action, showToast, Toast, Icon } from "@raycast/api";
import { isVaultSetup, getVaultMetadata, setupVault, unlockVault, tryUnlockVault } from "../../utils/vaultStorage";
import { VaultMetadata } from "../../types/vault";

interface VaultUnlockViewProps {
  onUnlocked: (key: Buffer) => void;
}

export function VaultUnlockView({ onUnlocked }: VaultUnlockViewProps) {
  const [isSetup, setIsSetup] = useState<boolean | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordHint, setPasswordHint] = useState("");
  const [storedMetadata, setStoredMetadata] = useState<VaultMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [passwordError, setPasswordError] = useState<string | undefined>();
  const [confirmError, setConfirmError] = useState<string | undefined>();

  const isUnlockingRef = useRef(false);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    async function checkState() {
      const setup = await isVaultSetup();
      setIsSetup(setup);
      if (setup) {
        const meta = await getVaultMetadata();
        setStoredMetadata(meta);
      }
      setIsLoading(false);
    }
    checkState();
  }, []);

  // Automatic unlock as the user types without pressing Enter / Ctrl+Enter
  function handlePasswordChange(val: string) {
    setPassword(val);
    if (passwordError) setPasswordError(undefined);

    if (isSetup !== true || !val.trim() || isUnlockingRef.current) {
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce slightly to allow natural typing speed, then check canary asynchronously
    debounceTimerRef.current = setTimeout(async () => {
      if (isUnlockingRef.current) return;
      try {
        const key = await tryUnlockVault(val, storedMetadata);
        if (key && !isUnlockingRef.current) {
          isUnlockingRef.current = true;
          await showToast({
            style: Toast.Style.Success,
            title: "Vault Unlocked",
          });
          onUnlocked(key);
        }
      } catch {
        // password incomplete, ignore silently
      }
    }, 150);
  }

  async function handleSetup() {
    setPasswordError(undefined);
    setConfirmError(undefined);

    if (!password.trim()) {
      setPasswordError("Password is required");
      return;
    }
    if (password !== confirmPassword) {
      setConfirmError("Passwords do not match");
      return;
    }

    try {
      const key = await setupVault(password, passwordHint);
      await showToast({
        style: Toast.Style.Success,
        title: "Vault Created Successfully",
        message: "Your master password is set and AES-256 encryption is active.",
      });
      onUnlocked(key);
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to initialize vault",
        message: String(err),
      });
    }
  }

  async function handleManualUnlock() {
    if (isUnlockingRef.current) return;
    setPasswordError(undefined);
    if (!password.trim()) {
      setPasswordError("Please enter your master password");
      return;
    }

    const key = await unlockVault(password);
    if (!key) {
      setPasswordError("Incorrect master password");
      await showToast({
        style: Toast.Style.Failure,
        title: "Access Denied",
        message: "Incorrect master password. Please try again.",
      });
      return;
    }

    isUnlockingRef.current = true;
    await showToast({
      style: Toast.Style.Success,
      title: "Vault Unlocked",
    });
    onUnlocked(key);
  }

  if (isLoading) {
    return <Form isLoading={true} />;
  }

  if (isSetup === false) {
    return (
      <Form
        actions={
          <ActionPanel>
            <Action.SubmitForm title="Create Vault & Encrypt" icon={Icon.Lock} onSubmit={handleSetup} />
          </ActionPanel>
        }
      >
        <Form.Description
          title="🔐 Encrypted Vault Setup"
          text="Choose a Master Password or PIN to secure your private links, secret notes, screenshots, and PDFs. All data is protected with zero-knowledge AES-256-GCM encryption."
        />
        <Form.PasswordField
          id="password"
          title="Master Password / PIN"
          placeholder="Enter a PIN or password of your choice"
          value={password}
          error={passwordError}
          onChange={(val) => {
            setPassword(val);
            if (passwordError) setPasswordError(undefined);
          }}
        />
        <Form.PasswordField
          id="confirmPassword"
          title="Confirm Password"
          placeholder="Re-enter your password to confirm"
          value={confirmPassword}
          error={confirmError}
          onChange={(val) => {
            setConfirmPassword(val);
            if (confirmError) setConfirmError(undefined);
          }}
        />
        <Form.TextField
          id="passwordHint"
          title="Password Hint (Optional)"
          placeholder="e.g. Birthday year + pet name"
          value={passwordHint}
          onChange={setPasswordHint}
        />
      </Form>
    );
  }

  const storedHint = storedMetadata?.passwordHint;

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Unlock Vault" icon={Icon.LockUnlocked} onSubmit={handleManualUnlock} />
        </ActionPanel>
      }
    >
      <Form.Description
        title="🔒 Vault is Locked"
        text={
          storedHint
            ? `Enter your master password or PIN to decrypt your private items. It will unlock automatically once entered!\n\n💡 Password Hint: ${storedHint}`
            : "Enter your master password or PIN to decrypt your private items. It will unlock automatically once entered!"
        }
      />
      <Form.PasswordField
        id="password"
        title="Master Password"
        placeholder="Enter your password / PIN (auto-unlocks)"
        value={password}
        error={passwordError}
        onChange={handlePasswordChange}
      />
    </Form>
  );
}
