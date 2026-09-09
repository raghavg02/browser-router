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

  // Dynamic, context-aware title placeholders that adapt to the selected category
  const titlePlaceholder =
    category === "bug"
      ? "e.g. Brave profile not loading logins, Edge inprivate shortcut..."
      : category === "feature"
      ? "e.g. Auto-detect Zen Browser, custom URL query presets..."
      : category === "general"
      ? "e.g. Loving the dual-mode search, quick idea on list layout..."
      : category === "other"
      ? "e.g. Shortcut customization, UI layout proposal..."
      : "e.g. Add Zen Browser support, or Brave profile launch issue...";

  async function handleSubmit() {
    let hasError = false;

    if (!category) {
      setCategoryError("Please select a feedback category");
      hasError = true;
    } else {
      setCategoryError(undefined);
    }

    if (category === "other" && !customCategory.trim()) {
      setCustomCategoryError("Please specify the category");
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
      setEmailError("Email is required");
      hasError = true;
    } else if (!EMAIL_REGEX.test(trimmedEmail)) {
      setEmailError("Please enter a valid email address");
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
          toast.message = "Thank you! We have received your feedback.";
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
      <Form.Description text="Have a complaint, idea, or request? Send it directly to our team!" />

      <Form.Dropdown
        id="category"
        title="Category"
        value={category}
        onChange={(val) => {
          setCategory(val);
          if (val) setCategoryError(undefined);
        }}
        error={categoryError}
      >
        <Form.Dropdown.Item value="" title="Select Feedback Category..." icon={Icon.QuestionMark} />
        <Form.Dropdown.Item value="bug" title="Bug Report / Complaint" icon={Icon.ExclamationMark} />
        <Form.Dropdown.Item value="feature" title="Feature Request / Future Update" icon={Icon.Stars} />
        <Form.Dropdown.Item value="general" title="General Feedback" icon={Icon.Message} />
        <Form.Dropdown.Item value="other" title="Other" icon={Icon.Tag} />
      </Form.Dropdown>

      {category === "other" && (
        <Form.TextField
          id="customCategory"
          title="Specify Category"
          placeholder="e.g. Performance, Translation, Shortcut idea..."
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
        title="Title"
        placeholder={titlePlaceholder}
        value={title}
        onChange={(val) => {
          setTitle(val);
          if (val.trim()) setTitleError(undefined);
        }}
        error={titleError}
      />

      <Form.TextArea
        id="description"
        title="Details"
        placeholder="Describe your idea, complaint, or issue with as much detail as possible..."
        value={description}
        onChange={(val) => {
          setDescription(val);
          if (val.trim()) setDescriptionError(undefined);
        }}
        error={descriptionError}
      />

      <Form.Separator />

      <Form.TextField
        id="email"
        title="Your Email"
        placeholder="your.email@example.com"
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
