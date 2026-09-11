import { useState, useEffect } from "react";
import { Form, ActionPanel, Action, useNavigation, showToast, Toast, Icon } from "@raycast/api";
import { VaultItem, VaultAttachment } from "../../types/vault";
import { BrowserProfile } from "../../types";
import { detectInstalledProfiles } from "../../utils/browserDetector";
import { saveAttachment, deleteAttachmentFile } from "../../utils/vaultStorage";

interface VaultItemFormProps {
  initialItem?: VaultItem;
  vaultKey: Buffer;
  categories: string[];
  onSave: (item: VaultItem) => Promise<void>;
}

export function VaultItemForm({ initialItem, vaultKey, categories, onSave }: VaultItemFormProps) {
  const { pop } = useNavigation();

  const [title, setTitle] = useState(initialItem?.title || "");
  const [url, setUrl] = useState(initialItem?.url || "");
  const [category, setCategory] = useState(initialItem?.category || categories[0] || "Personal");
  const [customCategory, setCustomCategory] = useState("");
  const [preferredProfileId, setPreferredProfileId] = useState(initialItem?.preferredProfileId || "");
  const [notes, setNotes] = useState(initialItem?.notes || "");
  const [selectedFiles, setSelectedFiles] = useState<string[]>([]);
  const [existingAttachments, setExistingAttachments] = useState<VaultAttachment[]>(initialItem?.attachments || []);

  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
  const [titleError, setTitleError] = useState<string | undefined>();
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    async function loadProfiles() {
      try {
        const detected = await detectInstalledProfiles();
        setProfiles(detected);
      } catch {
        // ignore
      }
    }
    loadProfiles();
  }, []);

  // Helper reserved for deleting individual attachments in edit mode
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function handleRemoveExistingAttachment(attId: string) {
    const att = existingAttachments.find((a) => a.id === attId);
    if (att) {
      deleteAttachmentFile(att.encryptedFileName);
    }
    setExistingAttachments((prev) => prev.filter((a) => a.id !== attId));
  }

  async function handleSubmit() {
    setTitleError(undefined);
    if (!title.trim()) {
      setTitleError("Title is required");
      return;
    }

    setIsSaving(true);
    await showToast({ style: Toast.Style.Animated, title: "Encrypting and saving item..." });

    try {
      const finalCategory = category === "__custom__" ? customCategory.trim() || "General" : category;
      const newAttachments: VaultAttachment[] = [...existingAttachments];

      // Encrypt each new attached file
      for (const filePath of selectedFiles) {
        try {
          const att = await saveAttachment(filePath, vaultKey);
          newAttachments.push(att);
        } catch (err) {
          console.error("Failed to encrypt attachment:", filePath, err);
        }
      }

      const item: VaultItem = {
        id: initialItem?.id || "vault_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        title: title.trim(),
        url: url.trim() || undefined,
        category: finalCategory,
        preferredProfileId: preferredProfileId || undefined,
        notes: notes.trim() || undefined,
        isFavorite: initialItem?.isFavorite || false,
        attachments: newAttachments,
        createdAt: initialItem?.createdAt || Date.now(),
        updatedAt: Date.now(),
      };

      await onSave(item);
      await showToast({
        style: Toast.Style.Success,
        title: initialItem ? "Vault Item Updated" : "Vault Item Saved",
      });
      pop();
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to save item",
        message: String(err),
      });
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <Form
      isLoading={isSaving}
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title={initialItem ? "Update Secret Item" : "Save to Vault"}
            icon={Icon.Lock}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="title"
        title="Title"
        placeholder="e.g. Staging Portal, Bank Account, AWS Console"
        value={title}
        error={titleError}
        onChange={(val) => {
          setTitle(val);
          if (titleError) setTitleError(undefined);
        }}
      />

      <Form.TextField
        id="url"
        title="URL / Destination (Optional)"
        placeholder="https://example.com or internal link"
        value={url}
        onChange={setUrl}
      />

      <Form.Dropdown id="category" title="Category" value={category} onChange={setCategory}>
        {categories.map((cat) => (
          <Form.Dropdown.Item key={cat} value={cat} title={cat} />
        ))}
        <Form.Dropdown.Item value="__custom__" title="+ New Custom Category…" />
      </Form.Dropdown>

      {category === "__custom__" ? (
        <Form.TextField
          id="customCategory"
          title="New Category Name"
          placeholder="e.g. Taxes, Crypto, Gaming"
          value={customCategory}
          onChange={setCustomCategory}
        />
      ) : null}

      <Form.Dropdown
        id="preferredProfileId"
        title="Preferred Browser Profile"
        value={preferredProfileId}
        onChange={setPreferredProfileId}
      >
        <Form.Dropdown.Item value="" title="None (Choose at Launch or Default)" icon={Icon.Globe} />
        {profiles.map((p) => (
          <Form.Dropdown.Item key={p.id} value={p.id} title={p.displayName} icon={Icon.Globe} />
        ))}
      </Form.Dropdown>

      <Form.TextArea
        id="notes"
        title="Secret Notes / Text"
        placeholder="Write secret markdown notes, credentials, 2FA backup codes, API tokens, or wireframe context..."
        value={notes}
        onChange={setNotes}
      />

      <Form.Separator />

      <Form.FilePicker
        id="files"
        title="Attach Files / Media"
        canChooseDirectories={false}
        canChooseFiles={true}
        allowMultipleSelection={true}
        value={selectedFiles}
        onChange={setSelectedFiles}
      />
      <Form.Description text="Attach screenshots, photos, PDF documents, or text files. All files are encrypted with AES-256-GCM." />

      {existingAttachments.length > 0 ? (
        <>
          <Form.Separator />
          <Form.Description
            title="Attached Encrypted Files"
            text={existingAttachments.map((a) => `• ${a.name} (${(a.size / 1024).toFixed(1)} KB)`).join("\n")}
          />
        </>
      ) : null}
    </Form>
  );
}
