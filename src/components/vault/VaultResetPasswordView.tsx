import { useState, useEffect } from "react";
import { Form, ActionPanel, Action, showToast, Toast, Icon, useNavigation } from "@raycast/api";
import {
  getVaultMetadata,
  unlockVault,
  verifySecurityAnswerAndGetKey,
  changeVaultMasterPassword,
} from "../../utils/vaultStorage";
import { VaultMetadata } from "../../types/vault";

export const PRESET_SECURITY_QUESTIONS = [
  "What was the name of your first pet?",
  "In what city or town were you born?",
  "What was the make of your first car?",
  "What is your mother's maiden name?",
  "What was your childhood nickname?",
  "Custom Security Question...",
];

interface VaultResetPasswordViewProps {
  onResetSuccess: (newKey: Buffer) => void;
}

export function VaultResetPasswordView({ onResetSuccess }: VaultResetPasswordViewProps) {
  const { pop } = useNavigation();
  const [metadata, setMetadata] = useState<VaultMetadata | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Method: "old_password" | "security_question"
  const [resetMethod, setResetMethod] = useState<string>("old_password");

  // Old Password verification
  const [oldPassword, setOldPassword] = useState("");
  const [oldPasswordError, setOldPasswordError] = useState<string | undefined>();

  // Security Question verification
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [securityAnswerError, setSecurityAnswerError] = useState<string | undefined>();

  // New Password
  const [newPassword, setNewPassword] = useState("");
  const [newPasswordError, setNewPasswordError] = useState<string | undefined>();
  const [confirmPassword, setConfirmPassword] = useState("");
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | undefined>();
  const [newHint, setNewHint] = useState("");

  // Optional: New/Updated Security Question
  const [selectedQuestion, setSelectedQuestion] = useState(PRESET_SECURITY_QUESTIONS[0]);
  const [customQuestion, setCustomQuestion] = useState("");
  const [newSecurityAnswer, setNewSecurityAnswer] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function loadMeta() {
      const meta = await getVaultMetadata();
      setMetadata(meta);
      setIsLoading(false);
    }
    loadMeta();
  }, []);

  async function handleReset() {
    setOldPasswordError(undefined);
    setSecurityAnswerError(undefined);
    setNewPasswordError(undefined);
    setConfirmPasswordError(undefined);

    if (!newPassword.trim()) {
      setNewPasswordError("New password cannot be empty");
      return;
    }
    if (newPassword !== confirmPassword) {
      setConfirmPasswordError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);
    let masterKey: Buffer | null = null;

    try {
      if (resetMethod === "old_password") {
        if (!oldPassword.trim()) {
          setOldPasswordError("Please enter your current password");
          setIsSubmitting(false);
          return;
        }
        masterKey = await unlockVault(oldPassword);
        if (!masterKey) {
          setOldPasswordError("Incorrect current master password");
          await showToast({
            style: Toast.Style.Failure,
            title: "Verification Failed",
            message: "The current master password you entered is incorrect.",
          });
          setIsSubmitting(false);
          return;
        }
      } else {
        if (!metadata?.securityQuestion || !metadata.recoveryToken) {
          await showToast({
            style: Toast.Style.Failure,
            title: "No Security Question",
            message: "No security question was configured for this vault. Please reset using your current password.",
          });
          setIsSubmitting(false);
          return;
        }
        if (!securityAnswer.trim()) {
          setSecurityAnswerError("Please enter your security answer");
          setIsSubmitting(false);
          return;
        }
        masterKey = await verifySecurityAnswerAndGetKey(securityAnswer);
        if (!masterKey) {
          setSecurityAnswerError("Incorrect security answer");
          await showToast({
            style: Toast.Style.Failure,
            title: "Verification Failed",
            message: "The security answer is incorrect. Please try again.",
          });
          setIsSubmitting(false);
          return;
        }
      }

      // Determine security question to save:
      let questionToSave: string | undefined;
      let answerToSave: string | undefined;

      if (newSecurityAnswer.trim()) {
        questionToSave = selectedQuestion === "Custom Security Question..." ? customQuestion.trim() : selectedQuestion;
        answerToSave = newSecurityAnswer.trim();
      } else if (resetMethod === "security_question" && securityAnswer.trim()) {
        // Keep existing security question and answer
        questionToSave = metadata?.securityQuestion;
        answerToSave = securityAnswer.trim();
      }

      const newKey = await changeVaultMasterPassword(
        masterKey,
        newPassword,
        newHint.trim() || undefined,
        questionToSave,
        answerToSave,
      );

      await showToast({
        style: Toast.Style.Success,
        title: "Password Reset Successfully",
        message: "Your vault master password has been updated and all items re-encrypted.",
      });

      onResetSuccess(newKey);
      pop();
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Reset Failed",
        message: String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <Form isLoading={true} />;
  }

  const hasConfiguredSecQuestion = !!(metadata?.securityQuestion && metadata?.recoveryToken);

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Reset & Re-Encrypt Vault" icon={Icon.Key} onSubmit={handleReset} />
        </ActionPanel>
      }
    >
      <Form.Dropdown
        id="resetMethod"
        title="Reset Method"
        value={resetMethod}
        onChange={(val) => {
          setResetMethod(val);
          setOldPasswordError(undefined);
          setSecurityAnswerError(undefined);
        }}
      >
        <Form.Dropdown.Item value="old_password" title="Verify with Current Password" icon={Icon.Key} />
        <Form.Dropdown.Item
          value="security_question"
          title={hasConfiguredSecQuestion ? "Answer Security Question" : "Security Question (Not configured)"}
          icon={Icon.Shield}
        />
      </Form.Dropdown>

      {resetMethod === "old_password" && (
        <Form.PasswordField
          id="oldPassword"
          title="Current Password"
          placeholder="Enter current master password"
          value={oldPassword}
          error={oldPasswordError}
          onChange={(val) => {
            setOldPassword(val);
            if (oldPasswordError) setOldPasswordError(undefined);
          }}
        />
      )}

      {resetMethod === "security_question" && (
        <>
          {hasConfiguredSecQuestion ? (
            <>
              <Form.Description title="Security Question" text={metadata?.securityQuestion || ""} />
              <Form.TextField
                id="securityAnswer"
                title="Your Answer"
                placeholder="Enter the answer to your security question"
                value={securityAnswer}
                error={securityAnswerError}
                onChange={(val) => {
                  setSecurityAnswer(val);
                  if (securityAnswerError) setSecurityAnswerError(undefined);
                }}
              />
            </>
          ) : (
            <Form.Description
              title="Notice"
              text="No security question was configured when this vault was created. Please use 'Verify with Current Password' above to reset."
            />
          )}
        </>
      )}

      <Form.Separator />

      <Form.PasswordField
        id="newPassword"
        title="New Password"
        placeholder="Enter new master password or PIN"
        value={newPassword}
        error={newPasswordError}
        onChange={(val) => {
          setNewPassword(val);
          if (newPasswordError) setNewPasswordError(undefined);
        }}
      />
      <Form.PasswordField
        id="confirmPassword"
        title="Confirm Password"
        placeholder="Re-enter new password"
        value={confirmPassword}
        error={confirmPasswordError}
        onChange={(val) => {
          setConfirmPassword(val);
          if (confirmPasswordError) setConfirmPasswordError(undefined);
        }}
      />
      <Form.TextField
        id="newHint"
        title="Password Hint (Optional)"
        placeholder="Leave empty or enter a helpful hint"
        value={newHint}
        onChange={setNewHint}
      />

      <Form.Separator />

      <Form.Dropdown id="newQuestion" title="Recovery Question" value={selectedQuestion} onChange={setSelectedQuestion}>
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
        id="newSecurityAnswer"
        title="Security Answer"
        placeholder="Answer for future password recovery"
        value={newSecurityAnswer}
        onChange={setNewSecurityAnswer}
      />
    </Form>
  );
}
