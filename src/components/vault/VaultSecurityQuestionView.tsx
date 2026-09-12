import { useState, useEffect } from "react";
import { Form, ActionPanel, Action, showToast, Toast, Icon, useNavigation } from "@raycast/api";
import { getVaultMetadata, setVaultSecurityQuestion } from "../../utils/vaultStorage";
import { PRESET_SECURITY_QUESTIONS } from "./VaultResetPasswordView";

interface VaultSecurityQuestionViewProps {
  vaultKey: Buffer;
  onUpdated?: () => void;
}

export function VaultSecurityQuestionView({ vaultKey, onUpdated }: VaultSecurityQuestionViewProps) {
  const { pop } = useNavigation();
  const [currentQuestion, setCurrentQuestion] = useState<string | undefined>();
  const [selectedQuestion, setSelectedQuestion] = useState(PRESET_SECURITY_QUESTIONS[0]);
  const [customQuestion, setCustomQuestion] = useState("");
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [answerError, setAnswerError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    async function loadMeta() {
      const meta = await getVaultMetadata();
      if (meta?.securityQuestion) {
        setCurrentQuestion(meta.securityQuestion);
        if (PRESET_SECURITY_QUESTIONS.includes(meta.securityQuestion)) {
          setSelectedQuestion(meta.securityQuestion);
        } else {
          setSelectedQuestion("Custom Security Question...");
          setCustomQuestion(meta.securityQuestion);
        }
      }
      setIsLoading(false);
    }
    loadMeta();
  }, []);

  async function handleSave() {
    setAnswerError(undefined);
    if (!securityAnswer.trim()) {
      setAnswerError("Please enter an answer for your security question");
      return;
    }

    const questionToSave =
      selectedQuestion === "Custom Security Question..." ? customQuestion.trim() : selectedQuestion;

    if (!questionToSave) {
      setAnswerError("Please enter or select a security question");
      return;
    }

    setIsSubmitting(true);
    try {
      await setVaultSecurityQuestion(vaultKey, questionToSave, securityAnswer.trim());
      await showToast({
        style: Toast.Style.Success,
        title: "Security Question Saved",
        message: "You can now use this security question to recover your vault anytime.",
      });
      if (onUpdated) onUpdated();
      pop();
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to save security question",
        message: String(err),
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  if (isLoading) {
    return <Form isLoading={true} />;
  }

  return (
    <Form
      isLoading={isSubmitting}
      actions={
        <ActionPanel>
          <Action.SubmitForm title="Save Security Question" icon={Icon.Check} onSubmit={handleSave} />
        </ActionPanel>
      }
    >
      <Form.Description
        title="Account Recovery"
        text={
          currentQuestion
            ? `Your vault currently has a security question configured.\nYou can update your question and answer below.`
            : "Set a security question and answer to safely recover or reset your master password if you ever forget it."
        }
      />

      {currentQuestion && <Form.Description title="Active Question" text={currentQuestion} />}

      <Form.Dropdown id="question" title="Security Question" value={selectedQuestion} onChange={setSelectedQuestion}>
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
        title="Security Answer"
        placeholder="Enter your answer (case-insensitive for recovery)"
        value={securityAnswer}
        error={answerError}
        onChange={(val) => {
          setSecurityAnswer(val);
          if (answerError) setAnswerError(undefined);
        }}
      />
    </Form>
  );
}
