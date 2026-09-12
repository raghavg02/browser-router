import { useState, useEffect } from "react";
import path from "path";
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
  const [customAppPath, setCustomAppPath] = useState(initialItem?.attachments?.[0]?.customAppPath || "");

  const [profiles, setProfiles] = useState<BrowserProfile[]>([]);
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

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  function handleRemoveExistingAttachment(attId: string) {
    const att = existingAttachments.find((a) => a.id === attId);
    if (att) {
      deleteAttachmentFile(att.encryptedFileName);
    }
    setExistingAttachments((prev) => prev.filter((a) => a.id !== attId));
  }

  async function handleSubmit() {
    setIsSaving(true);
    await showToast({ style: Toast.Style.Animated, title: "Encrypting and saving item..." });

    try {
      // Auto-generate title if left blank by user
      let finalTitle = title.trim();
      if (!finalTitle) {
        if (selectedFiles.length > 0) {
          finalTitle = path.basename(selectedFiles[0]);
        } else if (existingAttachments.length > 0) {
          finalTitle = existingAttachments[0].name;
        } else if (url.trim()) {
          try {
            const parsed = new URL(url.trim().startsWith("http") ? url.trim() : "https://" + url.trim());
            finalTitle = parsed.hostname.replace(/^www\./, "");
          } catch {
            finalTitle = url.trim();
          }
        } else if (notes.trim()) {
          const firstLine = notes
            .trim()
            .split("\n")[0]
            .replace(/^[#*\- >]+/, "")
            .trim();
          finalTitle = firstLine
            ? firstLine.length > 40
              ? firstLine.substring(0, 37) + "..."
              : firstLine
            : "Secret Note";
        } else {
          finalTitle = "Untitled Item";
        }
      }

      const finalCategory = category === "__custom__" ? customCategory.trim() || "General" : category;
      const newAttachments: VaultAttachment[] = existingAttachments.map((att) => ({
        ...att,
        customAppPath: customAppPath.trim() || undefined,
      }));

      // Encrypt each newly selected file
      for (const filePath of selectedFiles) {
        try {
          const att = await saveAttachment(filePath, vaultKey);
          att.customAppPath = customAppPath.trim() || undefined;
          newAttachments.push(att);
        } catch (err) {
          console.error("Failed to encrypt attachment:", filePath, err);
        }
      }

      const item: VaultItem = {
        id: initialItem?.id || "vault_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
        title: finalTitle,
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
        title="Title (Optional)"
        placeholder="Leave blank to use file name or URL"
        value={title}
        onChange={setTitle}
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

      <Form.TextField
        id="customAppPath"
        title="Custom Opening App (Optional)"
        placeholder="e.g. mspaint.exe, vlc.exe, notepad.exe, code.cmd (or leave empty for Windows default)"
        value={customAppPath}
        onChange={setCustomAppPath}
      />
      <Form.Description text="Leave empty to open with default Windows app, or specify an executable name / path." />

      {existingAttachments.length > 0 ? (
        <>
          <Form.Separator />
          <Form.Description
            title="Attached Encrypted Files"
            text={existingAttachments
              .map((a) => {
                const appInfo = a.customAppPath ? ` [Opens in: ${a.customAppPath}]` : " [Windows Default App]";
                return `• ${a.name} (${(a.size / 1024).toFixed(1)} KB)${appInfo}`;
              })
              .join("\n")}
          />
        </>
      ) : null}
    </Form>
  );
}
