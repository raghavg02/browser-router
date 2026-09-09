import { Form, ActionPanel, Action, useNavigation, showToast, Toast, Icon } from "@raycast/api";
import { useState } from "react";
import { getWebhookUrlForCategory } from "../config/feedbackConfig";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function FeedbackForm() {
  const { pop } = useNavigation();

  const [category, setCategory] = useState("");
  const [customCategory, setCustomCategory] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [email, setEmail] = useState("");

  const [categoryError, setCategoryError] = useState<string | undefined>();
  const [customCategoryError, setCustomCategoryError] = useState<string | undefined>();
  const [titleError, setTitleError] = useState<string | undefined>();
  const [descriptionError, setDescriptionError] = useState<string | undefined>();
  const [emailError, setEmailError] = useState<string | undefined>();
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit() {
    let hasError = false;

    if (!category) {
      setCategoryError("Please select a feedback category");
      hasError = true;
    } else {
      setCategoryError(undefined);
    }

    if (category === "other" && !customCategory.trim()) {
      setCustomCategoryError("Please tell us your feedback type");
      hasError = true;
    } else {
      setCustomCategoryError(undefined);
    }

    if (!title.trim()) {
      setTitleError("Title is required");
      hasError = true;
    } else {
      setTitleError(undefined);
    }

    if (!description.trim()) {
      setDescriptionError("Details are required");
      hasError = true;
    } else {
      setDescriptionError(undefined);
    }

    const trimmedEmail = email.trim();
    if (!trimmedEmail) {
      setEmailError("Email is required so we can notify you");
      hasError = true;
    } else if (!EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError("Please enter a valid email address (e.g. name@example.com)");
      hasError = true;
    } else {
      setEmailError(undefined);
    }

    if (hasError) return;

    setIsSubmitting(true);
    const toast = await showToast({
      style: Toast.Style.Animated,
      title: "Sending feedback...",
    });

    const webhookUrl = getWebhookUrlForCategory(category);

    let categoryDisplay = "General Feedback";
    let categoryPrefix = "💬 [GENERAL FEEDBACK]";
    let embedColor = 3900150; // Blue

    if (category === "bug") {
      categoryDisplay = "🚨 Bug Report / Complaint";
      categoryPrefix = "🚨 [COMPLAINT]";
      embedColor = 14689316; // Red (#E02424)
    } else if (category === "feature") {
      categoryDisplay = "✨ Feature Request / Future Update";
      categoryPrefix = "✨ [FEATURE REQUEST]";
      embedColor = 16096779; // Gold/Yellow (#F59E0B)
    } else if (category === "other") {
      const typeName = customCategory.trim() || "Other";
      categoryDisplay = `🧩 Other (${typeName})`;
      categoryPrefix = `🧩 [${typeName.toUpperCase()}]`;
      embedColor = 9133302; // Purple (#8B5CF6)
    }

    const embed = {
      title: `${categoryPrefix} ${title.trim()}`,
      color: embedColor,
      fields: [
        { name: "👤 Submitter Email", value: trimmedEmail, inline: true },
        { name: "🏷️ Category", value: categoryDisplay, inline: true },
        { name: "💻 System Info", value: `Windows (${process.arch}) • Search Router v2.0`, inline: true },
        { name: "📝 Details", value: description.trim() },
        { name: "📌 Status", value: "⏳ New / Awaiting Review", inline: true },
      ],
      footer: { text: "Search Router User Feedback" },
      timestamp: new Date().toISOString(),
    };

    if (webhookUrl && webhookUrl.trim().startsWith("https://")) {
      try {
        const response = await fetch(webhookUrl.trim(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            embeds: [embed],
          }),
        });

        if (response.ok) {
          toast.style = Toast.Style.Success;
          toast.title = "Feedback Sent!";
          toast.message = "Thank you! We will notify you by email as soon as it is reviewed.";
          pop();
        } else {
          toast.style = Toast.Style.Failure;
          toast.title = "Failed to send feedback";
          toast.message = `Discord returned status ${response.status}. Please check your webhook URL.`;
        }
      } catch (err: unknown) {
        toast.style = Toast.Style.Failure;
        toast.title = "Failed to send feedback";
        toast.message = err instanceof Error ? err.message : String(err);
      } finally {
        setIsSubmitting(false);
      }
    } else {
      // If webhook is not configured yet, record success and provide helpful instructions
      toast.style = Toast.Style.Success;
      toast.title = "Feedback Validated!";
      toast.message = "Form is ready. Configure your Discord Webhook in src/config/feedbackConfig.ts to receive alerts.";
      setIsSubmitting(false);
      pop();
    }
  }

  return (
    <Form
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Submit Feedback"
            icon={Icon.Envelope}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
      isLoading={isSubmitting}
    >
      <Form.Description text="Have a complaint, idea, or request? Send it directly to our team! We will email you when your request is reviewed and when it goes live." />

      <Form.Dropdown
        id="category"
        title="Feedback Category"
        value={category}
        onChange={(val) => {
          setCategory(val);
          if (val) setCategoryError(undefined);
        }}
        error={categoryError}
      >
        <Form.Dropdown.Item value="" title="Select Feedback Category..." icon={Icon.QuestionMark} />
        <Form.Dropdown.Item value="bug" title="🚨 Bug Report / Complaint" icon={Icon.ExclamationMark} />
        <Form.Dropdown.Item value="feature" title="✨ Feature Request / Future Update" icon={Icon.Stars} />
        <Form.Dropdown.Item value="general" title="💬 General Feedback" icon={Icon.Message} />
        <Form.Dropdown.Item value="other" title="🧩 Other" icon={Icon.Tag} />
      </Form.Dropdown>

      {category === "other" && (
        <Form.TextField
          id="customCategory"
          title="Specify Category"
          placeholder="e.g. Performance, Translation, Shortcut idea"
          info="Tell us your custom feedback type"
          value={customCategory}
          onChange={(val) => {
            setCustomCategory(val);
            if (val.trim()) setCustomCategoryError(undefined);
          }}
          error={customCategoryError}
        />
      )}

      <Form.TextField
        id="title"
        title="Title / Summary"
        placeholder="e.g. Add auto-detection for Zen Browser"
        value={title}
        onChange={(val) => {
          setTitle(val);
          if (val.trim()) setTitleError(undefined);
        }}
        error={titleError}
      />

      <Form.TextArea
        id="description"
        title="Details / Message"
        placeholder="Describe your idea, complaint, or issue with as much detail as possible..."
        value={description}
        onChange={(val) => {
          setDescription(val);
          if (val.trim()) setDescriptionError(undefined);
        }}
        error={descriptionError}
      />

      <Form.TextField
        id="email"
        title="Your Email"
        placeholder="your.email@example.com"
        info="Required so we can notify you when your request is received and when the feature/fix goes live!"
        value={email}
        onChange={(val) => {
          setEmail(val);
          if (val.trim()) setEmailError(undefined);
        }}
        error={emailError}
      />
    </Form>
  );
}
