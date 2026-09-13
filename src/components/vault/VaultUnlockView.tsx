import { useState, useEffect, useRef } from "react";
import { Form, ActionPanel, Action, showToast, Toast, Icon, confirmAlert } from "@raycast/api";
import { isVaultSetup, getVaultMetadata, setupVault, unlockVault, tryUnlockVault } from "../../utils/vaultStorage";
import { VaultMetadata } from "../../types/vault";
import { VaultResetPasswordView, PRESET_SECURITY_QUESTIONS } from "./VaultResetPasswordView";

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

  // Setup security question fields
  const [selectedQuestion, setSelectedQuestion] = useState(PRESET_SECURITY_QUESTIONS[0]);
  const [customQuestion, setCustomQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");

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

  async function handleShowHint() {
    const hint = storedMetadata?.passwordHint;
    if (hint && hint.trim()) {
      await confirmAlert({
        icon: Icon.LightBulb,
        title: "Password Hint",
        message: hint.trim(),
        primaryAction: {
          title: "OK",
        },
      });
    } else {
      await confirmAlert({
        icon: Icon.QuestionMark,
        title: "No Password Hint",
        message: "No password hint was configured for this vault.",
        primaryAction: {
          title: "OK",
        },
      });
    }
  }

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
      const q = securityAnswer.trim()
        ? selectedQuestion === "Custom Security Question..."
          ? customQuestion.trim()
          : selectedQuestion
        : undefined;

      const key = await setupVault(password, passwordHint, q, securityAnswer.trim() || undefined);
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
        navigationTitle="Vault — Setup Your Private Space"
        actions={
          <ActionPanel>
            <Action.SubmitForm title="Create Vault & Encrypt" icon={Icon.Lock} onSubmit={handleSetup} />
          </ActionPanel>
        }
      >
        <Form.Description
          title="🔒 Vault Setup"
          text="Choose a master password to protect your private browser profiles, tabs, files, and notes."
        />
        <Form.PasswordField
          id="password"
          title="Master Password"
          placeholder="Enter a password or PIN of your choice"
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

        <Form.Separator />

        <Form.Dropdown
          id="securityQuestion"
          title="Recovery Question (Optional)"
          value={selectedQuestion}
          onChange={setSelectedQuestion}
        >
          {PRESET_SECURITY_QUESTIONS.map((q) => (
            <Form.Dropdown.Item key={q} value={q} title={q} />
          ))}
        </Form.Dropdown>

        {selectedQuestion === "Custom Security Question..." && (
          <Form.TextField
            id="customQuestion"
            title="Custom Question"
            placeholder="e.g. What was the name of your first school?"
            value={customQuestion}
            onChange={setCustomQuestion}
          />
        )}

        <Form.TextField
          id="securityAnswer"
          title="Recovery Answer (Optional)"
          placeholder="Used to reset password if forgotten"
          value={securityAnswer}
          onChange={setSecurityAnswer}
        />
      </Form>
    );
  }

  return (
    <Form
      navigationTitle="Vault — Your private space"
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Unlock Vault" icon={Icon.LockUnlocked} onSubmit={handleManualUnlock} />
          <Action
            title="View Password Hint"
            icon={Icon.LightBulb}
            onAction={handleShowHint}
            shortcut={{ modifiers: ["ctrl"], key: "h" }}
          />
          <Action.Push
            title="Reset Master Password"
            icon={Icon.Key}
            target={<VaultResetPasswordView onResetSuccess={onUnlocked} />}
            shortcut={{ modifiers: ["ctrl", "shift"], key: "r" }}
          />
        </ActionPanel>
      }
    >
      <Form.Description text={"\n\n🔒  Vault is locked\nEnter your password to continue\n"} />

      <Form.PasswordField
        id="password"
        placeholder="Enter password..."
        info="Your vault decrypts and unlocks automatically as you type."
        value={password}
        error={passwordError}
        onChange={handlePasswordChange}
      />

      <Form.Description
        text={"\n🛡️  Your data stays on this device.\n\nTo reset: click Actions below (or press Ctrl + K)"}
      />
    </Form>
  );
}
